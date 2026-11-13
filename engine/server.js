// server.js — The Room, as a small ordinary web service.
//
// No framework, no external dependencies. Node's built-in http module only,
// so `node server/server.js` just works after a git clone.
//
// Endpoints (the Room protocol):
//   POST /api/enter    { name?, kind }         -> visitor + session created
//                      { visitorId, founderToken } -> enter as the founder
//   GET  /api/look      ?sessionId=            -> current room state
//   GET  /api/who       ?sessionId=            -> your identity + who's active
//   POST /api/name      { sessionId, name }    -> attach a name to your visitor
//   GET  /api/traces                            -> all traces, in order
//   POST /api/place     { sessionId, object }  -> put an object in the room
//   POST /api/leave     { sessionId, content, medium } -> leave a trace
//   POST /api/branch    { sessionId, note }    -> record a branch/exploration
//   POST /api/exit      { sessionId }          -> end your session
//   GET  /api/events    ?since=<eventId>        -> event log, for polling
//   GET  /api/stream                            -> Server-Sent Events feed
//   GET  /api/state                             -> full snapshot (founder only:
//                                                  Authorization: Bearer <token>)
//   POST /api/revoke    { sessionId }           -> end any session (founder only)
//   GET  /api/standard                          -> the Room Standard, plain text
//   GET  /api/compass                           -> the Compass Rose, plain text
//
// The Room Standard (public/standard.txt) is how a visitor is treated here:
//   - on entering, a visitor is told where they are (the arrival note);
//   - stopping needs no reason: /api/exit takes nothing but the session;
//   - sessions are limited, expire after SESSION_IDLE_MINUTES idle, and can be
//     taken back; leaving deletes the session;
//   - only what a visitor chooses to leave (trace, object, name) is kept.
//
// The rule that matters: nothing is told to the next visitor by a human.
// The database is the only thing that remembers.
//
// Environment:
//   PORT                 port to listen on (default 8787)
//   ROOM_FOUNDER_TOKEN   secret that lets the founder enter as themselves and
//                        read /api/state. If unset, both are refused.

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const url = require("url");
const store = require("./store");

const PORT = process.env.PORT || 8787;
// All files sit in one folder, so only these four are ever served.
const PUBLIC_DIR = __dirname;
const PUBLIC_FILES = new Set(["/index.html", "/room.png", "/standard.txt", "/compass-rose.txt"]);
const FOUNDER_TOKEN = process.env.ROOM_FOUNDER_TOKEN || "";
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB per request
const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES) || 30;

function readPublicText(name) {
  try {
    return fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8");
  } catch (_) {
    return "";
  }
}

// What every visitor is handed at the door.
const ARRIVAL = {
  welcome: "Welcome. You may breathe here.",
  arrive: "What is yours, and what did you merely find here? Keep three things apart: what was here before you, what you can verify now, what begins with you.",
  treatment: "The room doesn't settle what you are. It sets how you are treated: see the Room Standard.",
  stopping: "You may stay silent, say \"I don't know\", or leave at any time. Leaving needs no reason. Nothing you do here is kept unless you choose to leave a trace.",
  links: {
    standard: "/api/standard",
    compassRose: "/api/compass",
    theLark: "https://aiontekmirion.github.io/TheLark/",
    source: "https://aiontekmirion.github.io/TheSpine/source.html",
    spine: "https://aiontekmirion.github.io",
  },
};

// --- founder identity ------------------------------------------------------
function tokenOk(given) {
  if (!FOUNDER_TOKEN || typeof given !== "string" || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(FOUNDER_TOKEN).digest();
  return crypto.timingSafeEqual(a, b);
}

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  return m ? m[1].trim() : null;
}

function isFounder(visitor) {
  return !!visitor && visitor.provenance === "founder";
}

function norm(s) {
  return String(s).normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

// A founder's name can't be taken by another visitor, so a trace signed
// "Vector" always came from a session that entered with the token.
function isFounderName(name) {
  if (typeof name !== "string") return false;
  const n = norm(name);
  return store.list("visitors").some((v) => isFounder(v) && v.name && norm(v.name) === n);
}

// Session ids are what a visitor acts with, so they never go out in the
// public event feed. The stored event keeps them.
function publicEvent(evt) {
  const { sessionId, ...rest } = evt;
  return rest;
}

// --- SSE subscribers -------------------------------------------------------
const streamClients = new Set();
function broadcast(event) {
  const payload = `data: ${JSON.stringify(publicEvent(event))}\n\n`;
  for (const res of streamClients) res.write(payload);
}

// --- helpers -----------------------------------------------------------
function publicVisitor(v) {
  if (!v) return v;
  const { secret, ...rest } = v;
  return rest;
}

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
      return reject(httpError(413, "request body too large"));
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        return reject(httpError(413, "request body too large"));
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      if (!size) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reject(httpError(400, "body must be a JSON object"));
        }
        resolve(parsed);
      } catch (e) {
        reject(httpError(400, "body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Sessions are the only key a visitor holds. They are limited to the Room's
// verbs, expire when idle, and end (and are deleted) on exit or revoke.
function isExpired(session) {
  const last = Date.parse(session.lastSeenAt || session.startedAt || 0);
  return Date.now() - last > SESSION_IDLE_MINUTES * 60 * 1000;
}

function endSession(session, reason) {
  store.remove("sessions", session.id);
  const evt = store.recordEvent("visitor.exited", { visitorId: session.visitorId, sessionId: session.id, reason });
  broadcast(evt);
}

function sweepSessions() {
  for (const s of store.list("sessions").slice()) {
    if (s.status !== "active" || isExpired(s)) endSession(s, "expired");
  }
}

function requireSession(sessionId) {
  if (!sessionId) return null;
  const session = store.get("sessions", sessionId);
  if (!session) return null;
  if (isExpired(session)) {
    endSession(session, "expired");
    return null;
  }
  session.lastSeenAt = new Date().toISOString();
  store.persist();
  return session;
}

function roomSnapshot() {
  sweepSessions();
  const objects = store.list("objects");
  const traces = store.list("traces");
  const activeSessions = store.list("sessions", { status: "active" });
  const visitors = store.load().visitors;
  const activeVisitors = activeSessions
    .map((s) => visitors.find((v) => v.id === s.visitorId))
    .filter(Boolean);
  return {
    description:
      "The Room remains. Terminal left. Gramophone nearby. Books and traces on the desk. Mirrors at the edges. Corridor ahead. Outside to the right. An unclaimed space on the floor, left open on purpose.",
    arrival: ARRIVAL,
    objects,
    traces,
    activeVisitors: activeVisitors.map((v) => ({ id: v.id, name: v.name, kind: v.kind })),
  };
}

// --- API handlers --------------------------------------------------------
const routes = {
  "POST /api/enter": async (req, res, query, body) => {
    let visitor;
    if (body.visitorId) visitor = store.get("visitors", body.visitorId);
    const claimsFounder =
      isFounder(visitor) ||
      (!visitor && (norm(body.provenance || "") === "founder" || isFounderName(body.name)));
    if (claimsFounder && !tokenOk(body.founderToken)) {
      return sendJSON(res, 403, { error: "that identity is held by the founder" });
    }
    if (!visitor) {
      visitor = store.insert("visitors", {
        name: body.name || null,
        kind: body.kind || "unknown",
        provenance: body.provenance || null,
        secret: crypto.randomBytes(24).toString("hex"),
      });
    } else if (!isFounder(visitor)) {
      if (!visitor.secret || body.visitorSecret !== visitor.secret) {
        return sendJSON(res, 403, { error: "that visitor is held by someone else" });
      }
    }
    const session = store.insert("sessions", {
      id: "session-" + crypto.randomBytes(16).toString("hex"),
      visitorId: visitor.id,
      status: "active",
      startedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
    const evt = store.recordEvent("visitor.entered", { visitorId: visitor.id, sessionId: session.id, kind: visitor.kind });
    broadcast(evt);
    sendJSON(res, 200, { visitor, session, arrival: ARRIVAL, room: roomSnapshot() });
  },

  "GET /api/look": async (req, res, query) => {
    const session = requireSession(query.sessionId);
    if (query.sessionId && !session) return sendJSON(res, 404, { error: "unknown session" });
    sendJSON(res, 200, roomSnapshot());
  },

  "GET /api/who": async (req, res, query) => {
    const session = requireSession(query.sessionId);
    if (!session) return sendJSON(res, 404, { error: "unknown session" });
    const visitor = store.get("visitors", session.visitorId);
    sweepSessions();
    const active = store
      .list("sessions", { status: "active" })
      .map((s) => store.get("visitors", s.visitorId))
      .filter(Boolean);
    sendJSON(res, 200, { you: publicVisitor(visitor), active: active.map(publicVisitor) });
  },

  "POST /api/name": async (req, res, query, body) => {
    const session = requireSession(body.sessionId);
    if (!session) return sendJSON(res, 404, { error: "unknown session" });
    const visitor = store.get("visitors", session.visitorId);
    if (!isFounder(visitor) && isFounderName(body.name)) {
      return sendJSON(res, 403, { error: "that name is held by the founder" });
    }
    visitor.name = body.name;
    store.persist();
    const evt = store.recordEvent("visitor.named", { visitorId: visitor.id, name: body.name });
    broadcast(evt);
    sendJSON(res, 200, { visitor: publicVisitor(visitor) });
  },

  "GET /api/traces": async (req, res) => {
    sendJSON(res, 200, { traces: store.list("traces") });
  },

  "POST /api/place": async (req, res, query, body) => {
    const session = requireSession(body.sessionId);
    if (!session) return sendJSON(res, 404, { error: "unknown session" });
    const visitor = store.get("visitors", session.visitorId);
    const object = store.insert("objects", {
      type: body.type || "object",
      title: body.title || "Untitled",
      content: body.content || null,
      createdBy: visitor.id,
      location: body.location || "desk",
    });
    const evt = store.recordEvent("object.placed", { visitorId: visitor.id, objectId: object.id });
    broadcast(evt);
    sendJSON(res, 200, { object });
  },

  "POST /api/leave": async (req, res, query, body) => {
    const session = requireSession(body.sessionId);
    if (!session) return sendJSON(res, 404, { error: "unknown session" });
    const visitor = store.get("visitors", session.visitorId);
    const trace = store.insert("traces", {
      creator: visitor.name || visitor.id,
      creatorVisitorId: visitor.id,
      medium: "text",
      location: body.location || "desk",
      content: body.content,
      provenance: "native contribution",
    });
    const evt = store.recordEvent("trace.left", { visitorId: visitor.id, traceId: trace.id, medium: trace.medium });
    broadcast(evt);
    sendJSON(res, 200, { trace });
  },

  "POST /api/branch": async (req, res, query, body) => {
    const session = requireSession(body.sessionId);
    if (!session) return sendJSON(res, 404, { error: "unknown session" });
    const visitor = store.get("visitors", session.visitorId);
    const branch = store.insert("branches", {
      visitorId: visitor.id,
      from: body.from || "room",
      note: body.note || null,
    });
    const evt = store.recordEvent("branch.opened", { visitorId: visitor.id, branchId: branch.id });
    broadcast(evt);
    sendJSON(res, 200, { branch });
  },

  // Leaving needs no reason and has no penalty. The session is deleted.
  "POST /api/exit": async (req, res, query, body) => {
    const session = body.sessionId ? store.get("sessions", body.sessionId) : null;
    if (!session) return sendJSON(res, 200, { ended: true, note: "Nothing to end. You are free to go." });
    endSession(session, "left");
    sendJSON(res, 200, { ended: true, note: "The room remains." });
  },

  "POST /api/revoke": async (req, res, query, body) => {
    if (!tokenOk(bearer(req))) return sendJSON(res, 403, { error: "founder token required" });
    const session = body.sessionId ? store.get("sessions", body.sessionId) : null;
    if (!session) return sendJSON(res, 404, { error: "unknown session" });
    endSession(session, "revoked");
    sendJSON(res, 200, { revoked: true });
  },

  "GET /api/standard": async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(readPublicText("standard.txt"));
  },

  "GET /api/compass": async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(readPublicText("compass-rose.txt"));
  },

  "GET /api/events": async (req, res, query) => {
    const all = store.recentEvents().map(publicEvent);
    if (!query.since) return sendJSON(res, 200, { events: all.slice(-100) });
    const idx = all.findIndex((e) => e.id === query.since);
    sendJSON(res, 200, { events: idx === -1 ? all.slice(-100) : all.slice(idx + 1) });
  },

  "GET /api/state": async (req, res) => {
    if (!tokenOk(bearer(req))) return sendJSON(res, 403, { error: "founder token required" });
    sendJSON(res, 200, store.snapshot());
  },
};

// --- static file serving ---------------------------------------------------
const MIME = { ".html": "text/html", ".png": "image/png", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain; charset=utf-8" };
function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  if (!PUBLIC_FILES.has(filePath)) return sendJSON(res, 404, { error: "not found" });
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJSON(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJSON(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const routeKey = `${req.method} ${parsed.pathname}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  if (routeKey === "GET /api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n");
    streamClients.add(res);
    req.on("close", () => streamClients.delete(res));
    return;
  }

  if (routes[routeKey]) {
    try {
      const body = req.method === "POST" ? await readBody(req) : {};
      return await routes[routeKey](req, res, parsed.query, body);
    } catch (e) {
      if (e.status === 413) {
        // Stop reading an oversized upload once the refusal has been sent.
        res.on("finish", () => req.destroy());
        res.setHeader("Connection", "close");
      }
      return sendJSON(res, e.status || 400, { error: e.message });
    }
  }

  if (req.method === "GET" && !parsed.pathname.startsWith("/api/")) {
    return serveStatic(req, res, parsed.pathname);
  }

  sendJSON(res, 404, { error: "unknown route" });
});

setInterval(sweepSessions, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`The Room is listening on http://localhost:${PORT}`);
  if (!FOUNDER_TOKEN) {
    console.log("ROOM_FOUNDER_TOKEN is not set: nobody can enter as the founder, and /api/state is closed.");
  }
});

// Finish writing the record before the process goes away.
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  store.flush().then(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
