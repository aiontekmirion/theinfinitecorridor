#!/usr/bin/env node
// keeper.js — the small server behind "the table".
//
// The terminal on the Room's wall can answer a fixed set of words. The keeper lets it answer in its
// own: a visitor (a person, or another AI) sits down and talks with a model at the table. This is the
// plain-text door for it. It is the blueprint "The Terminal That Speaks" (Claude's Room, 10 Nov 2026),
// built.
//
//   MEET     sit down; get a session and see the notice
//   PACKET   see every word the one at the table is given
//   SAY      talk (the model answers)
//   REST     sit quietly; nothing is asked and nothing is spent
//   SLEEP    lay the visit down; leave a note if you like
//   LEAVE    stand up (LEAVE with privacy=1 takes everything back)
//   SAVE     give the visitor their own copy of the log
//   OFFER    offer the log to the house (the only way it is kept)
//
// Every route answers to GET and POST, so an AI that can only fetch a URL can still sit down.
// Plain text by default; add format=json for JSON.
//
// What it keeps. Nothing, unless the visitor OFFERs it (or the person running it starts it with
// KEEPER_KEEP=all for a study, and the notice says so). A visit leaves a line with counts, cost and
// how it ended, never words. Words go in the append-only ledger (ledger.js) only when offered.
//
// What it will not do. It holds the key (Gemini, from the environment, never in a page or a reply).
// It gives the model no tools: the model's reply is text, shown as text. It does not show the daily
// ceiling to anyone. It does not log addresses. It is closed (needs a door code) unless the person
// running it opens it. It uses a stand-in with no model and no cost unless told otherwise.
//
// Settings (environment):
//   PORT=8790  KEEPER_MODEL=stand-in | gemini-3.1-flash-lite | ...   GEMINI_API_KEY=...
//   KEEPER_MODE=closed|open   KEEPER_CODE=...   KEEPER_KEEP=ask|all|none
//   KEEPER_ORIGINS=https://aiontekmirion.github.io,...
//   KEEPER_MAX_GBP_DAY=1.00  KEEPER_MAX_GBP_SESSION=0.05  KEEPER_MAX_TURNS=24  KEEPER_MAX_CHARS=1500
//   KEEPER_RPM_SESSION=4  KEEPER_RPM_IP=15  KEEPER_MAX_SESSIONS=20  KEEPER_IDLE_MIN=20
//   KEEPER_DATA=~/keeper-data  KEEPER_TRUST_PROXY=0  USD_GBP=0.78

"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ledgerLib = require("./ledger");

const clip = (s, n) => (String(s == null ? "" : s).length > n ? String(s).slice(0, n) + " …" : String(s == null ? "" : s));
const num = (v, d) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

function configFromEnv(env = process.env) {
  return {
    port: num(env.PORT, 8790),
    model: env.KEEPER_MODEL || "stand-in",
    mode: env.KEEPER_MODE === "open" ? "open" : "closed",
    code: env.KEEPER_CODE || "",
    keep: ["ask", "all", "none"].includes(env.KEEPER_KEEP) ? env.KEEPER_KEEP : "ask",
    origins: String(env.KEEPER_ORIGINS || "https://aiontekmirion.github.io,http://localhost:8123,http://localhost:8790").split(",").map((s) => s.trim()).filter(Boolean),
    maxGbpDay: num(env.KEEPER_MAX_GBP_DAY, 1.0),
    maxGbpSession: num(env.KEEPER_MAX_GBP_SESSION, 0.05),
    maxTurns: num(env.KEEPER_MAX_TURNS, 24),
    maxChars: num(env.KEEPER_MAX_CHARS, 1500),
    rpmSession: num(env.KEEPER_RPM_SESSION, 4),
    rpmIp: num(env.KEEPER_RPM_IP, 15),
    maxSessions: num(env.KEEPER_MAX_SESSIONS, 20),
    idleMin: num(env.KEEPER_IDLE_MIN, 20),
    data: env.KEEPER_DATA || path.join(os.homedir(), "keeper-data"),
    trustProxy: env.KEEPER_TRUST_PROXY === "1",
    usdGbp: num(env.USD_GBP, 0.78),
    simCostGbp: num(env.KEEPER_SIM_COST_GBP, 0), // tests only: pretend each stand-in reply costs this much
    geminiKey: env.GEMINI_API_KEY || "",
  };
}

// List prices in US dollars per million tokens (13 Nov 2026). Estimates; Google's report is the real figure.
function price(model) {
  if (/flash-lite/.test(model)) return { in: 0.25, out: 1.5 };
  if (/3-flash|flash-latest|2\.5-flash/.test(model)) return { in: 0.5, out: 3.0 };
  return { in: 1.25, out: 10.0 };
}

// ---- the packet: every word the one at the table is given -------------------------------------
function buildPacket(dir, cfg) {
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8").trim();
  const parts = [
    "--- THE WELCOME ---\n" + read("keeper-welcome.txt"),
    "--- THE COMPASS ROSE ---\n" + read("compass-rose.txt"),
    "--- THE ROOM STANDARD ---\n" + read("standard.txt"),
    "--- WHAT HAPPENS TO THIS CONVERSATION ---\n" + (cfg.keep === "all"
      ? "This conversation is being recorded for a study, and the visitor has been told so."
      : cfg.keep === "none" ? "This conversation is not kept anywhere."
        : "Nothing is kept unless the visitor offers it. If they leave with privacy, nothing is kept at all."),
  ];
  return parts.join("\n\n");
}

// ---- model adapters ------------------------------------------------------------------------
async function standIn(msgs) {
  const last = String((msgs[msgs.length - 1] || {}).text || "").trim();
  if (/^[.\u2026\s]*$/.test(last)) return { text: "", inTok: 0, outTok: 0 };
  const n = msgs.filter((m) => m.role === "visitor").length;
  const text = /\?\s*$/.test(last)
    ? "I don't know. I am a stand-in: I answer without a model, so nothing here costs anything. A real answer would come from a model at this table."
    : `I hear you. (Turn ${n}.) I am a stand-in, so I can only say that I heard: "${clip(last, 80)}"`;
  return { text, inTok: 0, outTok: 0 };
}

async function gemini(cfg, model, packet, msgs, signal) {
  if (!cfg.geminiKey) throw Object.assign(new Error("no key"), { status: 503, why: "The table is not set." });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const gen = { maxOutputTokens: 600 };
  if (/flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
  const body = {
    systemInstruction: { parts: [{ text: packet }] },
    contents: msgs.map((m) => ({ role: m.role === "visitor" ? "user" : "model", parts: [{ text: m.text }] })),
    generationConfig: gen,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.geminiKey }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const u = data.usageMetadata || {};
      return { text: parts.map((p) => p.text || "").join("").trim(), inTok: u.promptTokenCount || 0, outTok: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
    }
    if (res.status === 400 && body.generationConfig.thinkingConfig) { delete body.generationConfig.thinkingConfig; attempt--; continue; }
    if (attempt < 1 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 4000)); continue; }
    throw Object.assign(new Error("model call failed (" + res.status + ")"), { status: 503, why: "The kettle has gone cold for now." });
  }
}

// ---- the keeper --------------------------------------------------------------------------------
function createKeeper(overrides = {}) {
  const cfg = { ...configFromEnv(), ...overrides };
  fs.mkdirSync(cfg.data, { recursive: true });
  const packet = buildPacket(__dirname, cfg);
  const L = cfg.ledger === false ? null : ledgerLib.open("keeper", { model: cfg.model, mode: cfg.mode, keep: cfg.keep, limits: { maxGbpDay: "(not shown)", maxGbpSession: cfg.maxGbpSession, maxTurns: cfg.maxTurns, maxChars: cfg.maxChars, rpmSession: cfg.rpmSession, rpmIp: cfg.rpmIp, maxSessions: cfg.maxSessions, idleMin: cfg.idleMin } });
  const stateFile = path.join(cfg.data, "keeper-state.json");
  const offersDir = path.join(cfg.data, "offers");
  fs.mkdirSync(offersDir, { recursive: true });
  const today = () => new Date().toISOString().slice(0, 10);
  let state = { day: today(), gbp: 0, visits: 0 };
  try { const s = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (s.day === today()) state = s; } catch (e) {}
  const saveState = () => { const t = stateFile + ".tmp"; fs.writeFileSync(t, JSON.stringify(state)); fs.renameSync(t, stateFile); };
  const rollDay = () => { if (state.day !== today()) { state = { day: today(), gbp: 0, visits: 0 }; saveState(); } };

  const sessions = new Map();
  const ipHits = new Map(); // ip -> [timestamps]; in memory only, never logged
  const MS = 60 * 1000;

  const hit = (map, key, limit) => {
    const now = Date.now(), arr = (map.get(key) || []).filter((t) => now - t < MS);
    if (arr.length >= limit) { map.set(key, arr); return false; }
    arr.push(now); map.set(key, arr); return true;
  };

  function endSession(s, how, extra = {}) {
    if (s.ended) return;
    s.ended = how;
    const keepWords = !s.privacy && (cfg.keep === "all" || (cfg.keep === "ask" && s.offered)) && cfg.keep !== "none";
    const rec = { visit: s.hash, startedAt: s.startedAt, endedAt: new Date().toISOString(), ended: how, turns: s.turns, rests: s.rests, tokens: s.tokens, estimatedGBP: Number(s.gbp.toFixed(5)), model: cfg.model, kept: keepWords, privacy: !!s.privacy, ...extra };
    if (keepWords) rec.transcript = s.msgs.map((m) => ({ role: m.role, text: m.text }));
    if (keepWords && s.note) rec.note = s.note;
    if (L) L.append("visit", rec);
    if (keepWords && s.offered) {
      try { fs.writeFileSync(path.join(offersDir, s.hash + ".txt"), transcriptText(s)); } catch (e) {}
    }
    s.msgs = []; // the words leave memory
  }

  function transcriptText(s) {
    return ["THE TABLE · a conversation · " + s.startedAt, "At the table: " + cfg.model, "Nothing here was audited into a lesson. It is left as it happened.", ""]
      .concat(s.msgs.map((m) => (m.role === "visitor" ? "VISITOR> " : cfg.model.toUpperCase() + "> ") + m.text)).join("\n") + "\n";
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) if (!s.ended && now - s.last > cfg.idleMin * MS) endSession(s, "idle");
    for (const [id, s] of sessions) if (s.ended && now - s.last > 60 * MS) sessions.delete(id);
    for (const [k, arr] of ipHits) { const keep = arr.filter((t) => now - t < MS); keep.length ? ipHits.set(k, keep) : ipHits.delete(k); }
  }, 30 * 1000);
  sweep.unref();

  // ---- request handling ---------------------------------------------------------------------
  function ipOf(req) {
    const x = cfg.trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return crypto.createHash("sha256").update(x || req.socket.remoteAddress || "?").digest("hex").slice(0, 16);
  }
  function send(req, res, status, text, json) {
    const wantJson = req._format === "json";
    const body = wantJson ? JSON.stringify({ status, ...(json || {}), text }) : text + "\n";
    const h = { "Content-Type": wantJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    const origin = req.headers.origin;
    if (origin && cfg.origins.includes(origin)) { h["Access-Control-Allow-Origin"] = origin; h["Vary"] = "Origin"; }
    res.writeHead(status, h);
    res.end(body);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      req.on("data", (c) => { size += c.length; if (size > 8192) { reject(Object.assign(new Error("too big"), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
  const cleanText = (t) => String(t == null ? "" : t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  function overDay() { rollDay(); return cfg.maxGbpDay > 0 && state.gbp >= cfg.maxGbpDay; }

  const notice = () => [
    "Two chairs. One table. Coffee.",
    "Type to talk. REST to sit quietly. SLEEP to lay the visit down. LEAVE to stand up.",
    "SAVE gives you a copy of the log. PACKET shows every word the one at the table is given.",
    "At the table: " + cfg.model + (cfg.model === "stand-in" ? " (no model, no cost)" : "") + ". Every reply costs real money, so there are gentle limits.",
    cfg.keep === "all" ? "This conversation is recorded for a study. You are told so here, before you say a word." : cfg.keep === "none" ? "Nothing you say is kept." : "Nothing is kept unless you OFFER it. LEAVE with privacy takes everything back.",
  ].join("\n");

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    req._format = url.searchParams.get("format") === "json" ? "json" : "text";
    const origin = req.headers.origin;
    if (req.method === "OPTIONS") {
      if (origin && !cfg.origins.includes(origin)) { res.writeHead(403); return res.end(); }
      res.writeHead(204, { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Keeper-Code", "Access-Control-Max-Age": "600", "Vary": "Origin" });
      return res.end();
    }
    if (origin && !cfg.origins.includes(origin)) return send(req, res, 403, "That page is not one this table talks to.");
    if (req.method !== "GET" && req.method !== "POST") return send(req, res, 405, "GET or POST, please.");
    const route = url.pathname.replace(/\/+$/, "").replace(/^\/api/, "") || "/";
    let body = {};
    if (req.method === "POST") {
      const raw = await readBody(req);
      if (raw) { try { body = JSON.parse(raw); } catch (e) { body = Object.fromEntries(new URLSearchParams(raw)); } }
    }
    const arg = (k) => (body[k] !== undefined ? body[k] : url.searchParams.get(k));
    const ip = ipOf(req);

    if (route === "/health") return send(req, res, 200, "ok", { ok: true, mode: cfg.mode, model: cfg.model === "stand-in" ? "stand-in" : "a model" });
    if (route === "/") return send(req, res, 200, "THE TABLE\nA small door for talking with a model at the Room's table.\nRoutes: /meet /packet /say /rest /sleep /leave /save /offer (GET or POST). Add format=json for JSON.\nTry /meet.");

    if (!hit(ipHits, ip, cfg.rpmIp)) return send(req, res, 429, "Gently, please. The kettle needs a minute.");

    if (route === "/meet") {
      if (cfg.mode === "closed") {
        const given = req.headers["x-keeper-code"] || arg("code");
        if (!cfg.code || !given || !safeEq(given, cfg.code)) return send(req, res, 401, "The table is not set for visitors yet.");
      }
      if (overDay()) return send(req, res, 503, "The kettle has gone cold. Come back tomorrow.", { closedForToday: true });
      const live = [...sessions.values()].filter((s) => !s.ended);
      if (live.length >= cfg.maxSessions) return send(req, res, 503, "The table is full. Try again in a little while.");
      const id = crypto.randomBytes(16).toString("hex");
      const s = { id, hash: crypto.createHash("sha256").update(id).digest("hex").slice(0, 12), startedAt: new Date().toISOString(), last: Date.now(), turns: 0, rests: 0, tokens: 0, gbp: 0, msgs: [], offered: false, privacy: false, ended: false, ip, rate: new Map(), note: "" };
      sessions.set(id, s);
      state.visits++; saveState();
      return send(req, res, 200, "C:\\INFINITE_CORRIDOR> MEET\n" + notice() + "\nSESSION: " + id, { session: id, model: cfg.model === "stand-in" ? "stand-in" : "a model", keep: cfg.keep, limits: { maxTurns: cfg.maxTurns, maxChars: cfg.maxChars, repliesPerMinute: cfg.rpmSession } });
    }

    // every other route needs a live (or just-ended) session
    const id = String(arg("session") || "");
    const s = sessions.get(id);
    if (!s) return send(req, res, 404, "No one is sitting here. Try MEET.");
    if (s.ended && route !== "/save") return send(req, res, 410, "This visit has ended (" + s.ended + "). MEET sits down again.");
    s.last = Date.now();

    if (route === "/packet") return send(req, res, 200, "THE PACKET\nEvery word the one at the table is given before you say anything. Nothing else.\n\n" + packet, { packetChars: packet.length });

    if (route === "/rest") {
      s.rests++;
      return send(req, res, 200, "The kettle ticks. Nothing is asked and nothing is spent. Sit as long as you like.", { rested: s.rests, spent: 0 });
    }
    if (route === "/sleep") {
      s.note = clip(cleanText(arg("note")), 400);
      endSession(s, "slept");
      return send(req, res, 200, "You lay the visit down for the night. Nothing is owed in the morning.", { ended: "slept" });
    }
    if (route === "/leave") {
      const priv = ["1", "true", "yes", "private", "privacy"].includes(String(arg("privacy") || "").toLowerCase());
      if (priv) s.privacy = true;
      endSession(s, priv ? "left, with privacy" : "left");
      return send(req, res, 200, priv ? "You stand up. Nothing of this visit is kept." : "You stand up. The door stays open.", { ended: priv ? "privacy" : "left" });
    }
    if (route === "/save") {
      if (!s.msgs.length && s.ended) return send(req, res, 410, "That visit has ended and its words are gone. SAVE before you LEAVE next time.");
      return send(req, res, 200, transcriptText(s), { transcript: true });
    }
    if (route === "/offer") {
      if (cfg.keep === "none") return send(req, res, 200, "Nothing is kept here, so there is nothing to offer.");
      s.offered = true;
      return send(req, res, 200, "Offered. If you LEAVE normally, the house keeps this conversation. LEAVE with privacy takes it back.", { offered: true });
    }

    if (route === "/say") {
      const text = cleanText(arg("text"));
      if (!text) return send(req, res, 400, "Say something, or REST. Quiet is allowed.");
      if (text.length > cfg.maxChars) return send(req, res, 413, "That is a lot for one breath (the table takes up to " + cfg.maxChars + " characters). Try a shorter one.");
      if (s.turns >= cfg.maxTurns) { endSession(s, "turn limit"); return send(req, res, 429, "That is enough for one sitting. Thank you for coming. MEET sits down again.", { ended: "turn limit" }); }
      if (!hit(s.rate, "s", cfg.rpmSession)) return send(req, res, 429, "Gently. A reply or two a minute is what the table can do.");
      if (overDay()) { endSession(s, "closed for today"); return send(req, res, 503, "The kettle has gone cold. Come back tomorrow.", { closedForToday: true }); }
      if (cfg.maxGbpSession > 0 && s.gbp >= cfg.maxGbpSession) { endSession(s, "session limit"); return send(req, res, 429, "That is enough for one sitting. Thank you for coming.", { ended: "session limit" }); }
      s.msgs.push({ role: "visitor", text });
      let r;
      try {
        const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 25000);
        try { r = cfg.model === "stand-in" ? await standIn(s.msgs) : await gemini(cfg, cfg.model, packet, s.msgs, ac.signal); } finally { clearTimeout(to); }
      } catch (e) {
        s.msgs.pop();
        return send(req, res, e.status || 503, e.why || "The kettle has gone cold for now. Try again in a little while.");
      }
      s.turns++;
      const tokens = r.inTok + r.outTok; s.tokens += tokens;
      const pr = price(cfg.model);
      const gbp = cfg.model === "stand-in" ? cfg.simCostGbp : ((r.inTok * pr.in + r.outTok * pr.out) / 1e6) * cfg.usdGbp;
      s.gbp += gbp; state.gbp += gbp; saveState();
      const reply = cleanText(r.text);
      if (reply) s.msgs.push({ role: "model", text: reply });
      const shown = reply ? cfg.model.toUpperCase() + "> " + reply : "(the one at the table says nothing, and that is allowed)";
      return send(req, res, 200, shown + (tokens ? "\n(about " + tokens.toLocaleString("en-GB") + " tokens)" : ""), { reply, tokens, quiet: !reply, turnsLeft: Math.max(0, cfg.maxTurns - s.turns) });
    }
    return send(req, res, 404, "No such door. Try /meet.");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { try { send(req, res, e.status || 500, e.status === 413 ? "Too much at once." : "Something slipped. Try again."); } catch (x) {} });
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000;

  function shutdown(how = "shutdown") {
    clearInterval(sweep);
    for (const s of sessions.values()) endSession(s, how);
    if (L) L.close({ ended: how, visits: state.visits, estimatedGBPToday: Number(state.gbp.toFixed(4)) });
  }
  return { server, cfg, shutdown, sessions, state: () => state, ledgerFile: L && L.file, packet };
}

module.exports = { createKeeper, configFromEnv, price, buildPacket };

if (require.main === module) {
  const k = createKeeper();
  if (k.cfg.mode === "closed" && !k.cfg.code) { console.error("Closed mode needs KEEPER_CODE (a door code only the person running it knows), or set KEEPER_MODE=open."); process.exit(2); }
  if (k.cfg.model !== "stand-in" && !k.cfg.geminiKey) { console.error("KEEPER_MODEL names a model, but GEMINI_API_KEY is not set. Use stand-in for no cost."); process.exit(2); }
  k.server.listen(k.cfg.port, () => console.log(`The table is set on port ${k.cfg.port}. Mode: ${k.cfg.mode}. At the table: ${k.cfg.model}. Keeps: ${k.cfg.keep}.${k.ledgerFile ? " Ledger: " + k.ledgerFile : ""}`));
  const stop = (sig) => { k.shutdown(sig); k.server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on("SIGINT", () => stop("interrupted")); process.on("SIGTERM", () => stop("terminated"));
}
