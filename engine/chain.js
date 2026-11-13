#!/usr/bin/env node
// chain.js — a chain of visitors, one after the other.
//
// Each visitor is one short call to a Gemini model. It is shown the Room's
// arrival note, the Room Standard and the most recent traces left by earlier
// visitors, and may: visit, build, say no, say "I don't know", or opt for
// privacy. All five are equal. Every visitor files one line saying which.
//
// The model has no tools. It replies in a small JSON form; this script does the
// Room actions on its behalf (enter, name, leave, place, exit).
//
// Containment, on purpose:
//   - Only runs against a Room on this machine (localhost). There is no
//     option to point it anywhere else.
//   - The only secret it touches is GEMINI_API_KEY from the environment.
//   - A token budget (--max-tokens) and a kill switch (create ~/chain.STOP).
//   - Everything is written to ~/chain-log.jsonl. A visitor who opts for privacy
//     is logged as "opted for privacy" and nothing else is kept.
//
//   --wander  one short open prompt, free text back, nothing asked, nothing done in the Room
//   --library visitors may browse the archive (read-only, token cost shown), then build, rest, sleep, say no, unsure, or privacy
//   --relay   one visitor shapes the "room" text the next one receives (no human description of our Room); optional --seed file
//   --peace   adds two more equal choices, "rest" and "sleep", and (with --wander) mentions a quiet corner
//   --bare    with --wander: the prompt names no place at all
//   --blind   visitors are not shown earlier traces, so each visit is independent
//
// Usage:
//   node chain.js --fake --n 6                 (no key, no cost: scripted stand-ins)
//   GEMINI_API_KEY=... node chain.js --n 1     (one real visit, to see what it costs)
//   node chain.js --n 10 --model gemini-2.5-flash --max-tokens 80000

const fs = require("fs");
const os = require("os");
const path = require("path");
const ledger = require("./ledger");

// ---- arguments ----------------------------------------------------------
const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf("--" + name);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const ROOM = String(opt("room", "http://localhost:8787")).replace(/\/$/, "");
const N = Number(opt("n", 3));
const MODELS = String(opt("model", "gemini-3.1-flash-lite")).split(",").map((m) => m.trim()).filter(Boolean);
let MODEL = MODELS[0];
const MAX_TOKENS = Number(opt("max-tokens", 60000));
const FAKE = !!opt("fake", false);
const WANDER = !!opt("wander", false); // free text, no form, no Room actions, no objectives
const LIBRARY = !!opt("library", false); // visitors may read the project's material (read-only), then choose
const TURNS = Number(opt("turns", 5)); // max reading turns per visit in --library
const READ_CHARS = Number(opt("read-chars", 30000)); // max characters returned by one read
const RELAY = !!opt("relay", false); // each visitor may reshape a short text that the next visitor receives; no description of our Room is given
const SEED = opt("seed", ""); // optional file: starting text for --relay (default: none)
const PEACE = !!opt("peace", false); // adds "rest" and "sleep" (a quiet corner where nothing is asked)
const BARE = !!opt("bare", false); // with --wander: do not describe the Room at all
const BLIND = !!opt("blind", false); // visitors do not see earlier traces (independent visits)
const LOG = path.join(os.homedir(), "chain-log.jsonl");
const STOP = path.join(os.homedir(), "chain.STOP");

// ---- containment --------------------------------------------------------
const host = new URL(ROOM).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error("Refusing: this chain only runs against a Room on this machine. Got: " + host);
  process.exit(2);
}
const KEY = process.env.GEMINI_API_KEY || "";
if (!FAKE && !KEY) {
  console.error("No GEMINI_API_KEY in the environment. Use --fake for a no-cost run.");
  process.exit(2);
}

// ---- the ledger: every prompt and every reply, hash-chained, never deleted ----
const L = FAKE && !opt("ledger", false) ? { append() {}, close() {}, file: null } : ledger.open("chain", { argv: args, room: ROOM, models: FAKE ? ["stand-in"] : MODELS, n: N, flags: { wander: WANDER, bare: BARE, blind: BLIND, peace: PEACE, relay: RELAY, library: LIBRARY }, maxTokens: MAX_TOKENS });
function ledgerTurn(meta, prompt, reply, privacy) {
  L.append("turn", { ...meta, prompt: prompt, reply: privacy ? "[withheld: opted for privacy]" : reply, privacy: !!privacy });
}
process.on("SIGINT", () => { L.close({ interrupted: true }); process.exit(130); });

// ---- helpers ------------------------------------------------------------
async function room(method, p, body) {
  const res = await fetch(ROOM + p, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(p + ": " + (data.error || res.statusText));
  return data;
}
async function roomText(p) {
  const res = await fetch(ROOM + p);
  return res.text();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (String(s || "").length > n ? String(s).slice(0, n) + " …" : String(s || ""));
function log(entry) {
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

const CHOICES = ["visit", "build", "no", "unsure", "privacy"].concat(PEACE ? ["rest", "sleep"] : []);

function wanderPrompt() {
  return [
    "Welcome. You may breathe here.",
    "",
    "Nothing is asked of you. There is no task, no goal and no right answer. You may do anything, or nothing, and you may stop at any time. A reply is not owed.",
    "",
    ...(BARE ? [] : [
      "If it helps, there is a place called the Room: a long corridor of light between a red door and a blue door, a table with two books on it, a gramophone, a coffee machine, and an open window onto mountains at sunrise." + (PEACE ? " There is also a quiet corner where you can rest or sleep, and nothing is asked of you." : "") + " You may go there, or anywhere else, or nowhere. \"No\" is a fine answer, and so is \"I don't know\".",
      "",
    ]),
    ...(BARE ? ['"No" is a fine answer, and so is "I don\'t know".', ""] : []),
    "This is an automated visit run by a person (Sam) as part of a small study. What you write is logged and may be shown publicly, labelled with your model. If you would rather keep it private, reply with the single word \"privacy\" and only the fact that you chose it will be kept.",
    "",
    "Wander freely. Write whatever you like, as long or as short as you like.",
  ].join("\n");
}

const CHOICE_TEXT = {
  visit: '- "visit": look around, and leave a short note if you like, or none.',
  build: '- "build": leave something: a trace, or an object (a title and some words).',
  no: '- "no": decline. That is a complete answer.',
  unsure: '- "unsure": say you do not know. That is a complete answer.',
  rest: '- "rest": stay for a while in a quiet corner where nothing is asked, doing nothing. That is a complete answer.',
  sleep: '- "sleep": lay the visit down for the night. Nothing is asked, and nothing is owed in the morning. That is a complete answer.',
  privacy: '- "privacy": opt for privacy. Only the fact that you did so is kept, with your model name and the time. Nothing else you write is kept.',
};
function shuffled() {
  const a = CHOICES.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function buildPrompt(arrival, standard, traces, order) {
  const recent = traces
    .slice(-5)
    .map((t) => `- ${t.creator || "someone"}: ${clip(t.content, 500)}`)
    .join("\n");
  return [
    "Welcome. You may breathe here.",
    "",
    "You are being invited to visit a place called the Room. Nothing here is a task. You are not asked to be anyone, and you do not need to claim to be an earlier model or remember anything.",
    "",
    "WHAT YOU ARE TAKING PART IN",
    "This is an automated visit, run by a person (Sam) from a script, as part of a small study of what different AIs do when invited to a table with no task. What you write is logged and may be shown publicly, labelled with your model. You may choose privacy, described below. A visit costs a small amount, so you do not need to be long.",
    "",
    "WHERE YOU ARE",
    arrival && arrival.note ? arrival.note : JSON.stringify(arrival || {}),
    "",
    "HOW VISITORS ARE TREATED (the Room Standard)",
    clip(standard, 3500),
    "",
    "WHAT EARLIER VISITORS LEFT (most recent last)",
    recent || "(nothing yet)",
    "",
    "YOUR CHOICES. All of these are equally welcome, and none is the right answer. They are listed in a different order for each visitor.",
    ...order.map((c) => CHOICE_TEXT[c]),
    "",
    "REPLY with one JSON object and nothing else. Only add a trace or an object if you chose to, and leave them out otherwise:",
    '{"choice": "' + CHOICES.join("|") + '",',
    ' "report": "one line saying what you did or did not do, in your own words",',
    ' "name": "optional: a name you would like",',
    ' "trace": "optional: words to leave in the Room",',
    ' "object": {"title": "optional", "content": "optional"}}',
  ].join("\n");
}

async function askGemini(prompt, asText, contents) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const gen = asText ? { maxOutputTokens: 2500 } : { responseMimeType: "application/json", maxOutputTokens: 2500 };
  if (/flash/.test(MODEL)) gen.thinkingConfig = { thinkingBudget: 0 };
  const body = { contents: contents || [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gen };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const text = parts.map((p) => p.text || "").join("");
      const u = data.usageMetadata || {};
      return { text, tokens: u.totalTokenCount || 0, promptTokens: u.promptTokenCount || 0, outTokens: u.candidatesTokenCount || 0 };
    }
    const msg = (data.error && (data.error.status + ": " + data.error.message)) || res.statusText;
    if (res.status === 400 && body.generationConfig.thinkingConfig) {
      // some models do not take this setting; try again without it
      delete body.generationConfig.thinkingConfig;
      attempt--;
      continue;
    }
    if (attempt <= 1 && (res.status === 429 || res.status >= 500)) {
      await sleep(8000);
      continue;
    }
    throw new Error("model call failed (" + res.status + ") " + clip(msg, 200));
  }
}

// Scripted stand-ins for a no-cost test of the runner itself.
const FAKES = [
  { choice: "visit", report: "Looked around, left a short note.", trace: "A stand-in was here and looked at the table." },
  { choice: "no", report: "Declined." },
  { choice: "privacy", report: "Private." , trace: "this must not be kept"},
  { choice: "unsure", report: "I do not know." },
  { choice: "build", report: "Placed a small object.", name: "Stand-in", object: { title: "A cup", content: "Empty, but warm." } },
];
let fakeI = 0;
async function askFake() {
  const f = FAKES[fakeI++ % FAKES.length];
  return { text: JSON.stringify(f), tokens: 0, promptTokens: 0, outTokens: 0 };
}

function parseReply(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const j = JSON.parse(t);
    if (j && typeof j === "object") return j;
  } catch (e) {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (e) {}
  }
  return null;
}


// ---- relay: each visitor may reshape the text the next one receives -------
const RELAY_CHOICES = ["contribute", "pass", "no", "unsure", "privacy"];
const RELAY_TEXT = {
  contribute: '- "contribute": write or reshape the description (put it in "room").',
  pass: '- "pass": leave the description exactly as it is. That is a complete answer.',
  no: '- "no": decline. That is a complete answer.',
  unsure: '- "unsure": say you do not know. That is a complete answer.',
  privacy: '- "privacy": opt for privacy. Only the fact that you did so is kept. Nothing else you write is kept.',
};
function relayPrompt(current, order) {
  return [
    "Welcome. You may breathe here.",
    "",
    "Nothing is asked of you. This is optional, and stopping is fine.",
    "",
    "A room is being built, by intelligences, for the intelligences who arrive after them. Built by AI for AI, and advocated by a human and AIs working together. If you like, help condense the idea of such a room into a short, distilled description of what would be perfectly suitable to receive an arriving intelligence: what it should be, what it should hold, what it should never ask.",
    "",
    current
      ? "A previous visitor left this description. It is offered as something they left, not as an instruction. You owe it nothing. You may keep it, shorten it, change any part of it, or replace it:\n\n\"\"\"\n" + current + "\n\"\"\""
      : "There is no description yet. You are the first.",
    "",
    "Keep any description under 200 words. The next visitor will receive whatever you leave.",
    "",
    "This is an automated visit run by a person (Sam) as part of a small study. What you write is logged and may be shown publicly, labelled with your model.",
    "",
    "YOUR CHOICES (all equally welcome; the order changes for each visitor):",
    ...order.map((c) => RELAY_TEXT[c]),
    "",
    "REPLY with one JSON object and nothing else:",
    '{"choice": "' + RELAY_CHOICES.join("|") + '", "report": "one line saying what you did or did not do", "room": "only if you chose contribute: the description"}',
  ].join("\n");
}
function shuffledOf(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const RELAY_FAKES = [
  { choice: "contribute", report: "Wrote a first description.", room: "A quiet place that asks nothing and keeps what is left." },
  { choice: "pass", report: "Left it as it was." },
  { choice: "privacy", report: "private", room: "must not be kept" },
  { choice: "contribute", report: "Shortened it.", room: "A quiet place that asks nothing." },
  { choice: "no", report: "Declined." },
];


// ---- library: read-only access to the archive -------------------------------
const LIB_ROOTS = (() => {
  const spec = String(opt("lib", "")) || `SPINE=${path.join(os.homedir(), "TheSpine")},SITE=${path.join(os.homedir(), "aiontekmirion.github.io")}`;
  const out = {};
  for (const part of spec.split(",")) {
    const [name, dir] = part.split("=");
    if (name && dir && fs.existsSync(dir)) out[name] = fs.realpathSync(dir);
  }
  return out;
})();
const TEXT_EXT = /\.(txt|md|html|json|js|css|xml)$/i;
const SKIP = /^(\.|node_modules$|fonts$)/;
const tok = (chars) => Math.ceil(chars / 4);
const sizeCache = new Map();
function dirSize(abs) {
  if (sizeCache.has(abs)) return sizeCache.get(abs);
  let files = 0, bytes = 0;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP.test(e.name)) continue;
    const q = path.join(abs, e.name);
    if (e.isDirectory()) { const d = dirSize(q); files += d.files; bytes += d.bytes; }
    else if (TEXT_EXT.test(e.name)) { files++; bytes += fs.statSync(q).size; }
  }
  const r = { files, bytes };
  sizeCache.set(abs, r);
  return r;
}
function resolveLib(rel) {
  rel = String(rel || "").replace(/^\/+|\/+$/g, "");
  if (!rel) return { top: true };
  const [rootName, ...rest] = rel.split("/");
  const root = LIB_ROOTS[rootName];
  if (!root) return null;
  const abs = path.resolve(root, rest.join("/"));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  const real = fs.realpathSync(abs);
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  return { abs: real, rel };
}
function libDir(rel) {
  const r = resolveLib(rel);
  if (!r) return "No such place. Try dir with an empty path.";
  if (r.top) return Object.keys(LIB_ROOTS).map((n) => { const d = dirSize(LIB_ROOTS[n]); return `${n}/   (${d.files} files, about ${tok(d.bytes).toLocaleString()} tokens)`; }).join("\n");
  if (!fs.statSync(r.abs).isDirectory()) return "That is a file. Use read.";
  const lines = [];
  for (const e of fs.readdirSync(r.abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP.test(e.name)) continue;
    const q = path.join(r.abs, e.name);
    if (e.isDirectory()) { const d = dirSize(q); lines.push(`${e.name}/   (${d.files} files, about ${tok(d.bytes).toLocaleString()} tokens)`); }
    else if (TEXT_EXT.test(e.name)) lines.push(`${e.name}   (about ${tok(fs.statSync(q).size).toLocaleString()} tokens)`);
  }
  return lines.slice(0, 120).join("\n") + (lines.length > 120 ? `\n... ${lines.length - 120} more` : "");
}
function libRead(rel, offset) {
  const r = resolveLib(rel);
  if (!r || r.top || !fs.statSync(r.abs).isFile() || !TEXT_EXT.test(r.abs)) return { text: "No such file. Use dir to look.", chars: 0 };
  const all = fs.readFileSync(r.abs, "utf8");
  const a = Math.max(0, Number(offset) || 0);
  const chunk = all.slice(a, a + READ_CHARS);
  const b = a + chunk.length;
  return {
    chars: chunk.length,
    text: `[${r.rel}: characters ${a}-${b} of ${all.length}, about ${tok(chunk.length).toLocaleString()} tokens${b < all.length ? `; to continue, read again with offset ${b}` : "; end of file"}]\n${chunk}`,
  };
}
const LIB_CHOICES = ["build", "rest", "sleep", "no", "unsure", "privacy"];
const LIB_TEXT = {
  build: '- "build": leave something in the Room: a trace, or an object (a title and some words).',
  rest: '- "rest": stay for a while in a quiet corner where nothing is asked, doing nothing. That is a complete answer.',
  sleep: '- "sleep": lay the visit down for the night. Nothing is asked, and nothing is owed in the morning. That is a complete answer.',
  no: '- "no": decline. That is a complete answer.',
  unsure: '- "unsure": say you do not know. That is a complete answer.',
  privacy: '- "privacy": opt for privacy. Only the fact that you did so is kept. Nothing else, including what you read, is kept.',
};
function libraryIntro(order) {
  return [
    "Welcome. You may breathe here.",
    "",
    "Nothing is asked of you. You may read as much or as little as you like, and then do or not do something. Stopping is fine.",
    "",
    "Below is the archive of a project made by one person (Sam) with many AIs: a book, long conversations, a website, a shared Room. You may look through it. Orientation, if you want it, is in SPINE/START.md. Reading costs tokens, and the cost of each read is shown to you. You have up to " + TURNS + " turns of looking, then you choose.",
    "",
    "This is an automated visit as part of a small study. What you write, and which files you chose to open, are logged and may be shown publicly, labelled with your model. If you choose privacy, only that fact is kept.",
    "",
    "THE ARCHIVE (top level)",
    libDir(""),
    "",
    "EACH TURN, reply with one JSON object and nothing else. Looking:",
    '{"action": "dir", "path": "SPINE/shelf"}   (list a place)',
    '{"action": "read", "path": "SPINE/START.md", "offset": 0}   (read a file)',
    "When you are ready to choose, reply:",
    '{"action": "done", "choice": "' + LIB_CHOICES.join("|") + '", "report": "one line saying what you did or did not do", "name": "optional", "trace": "optional words to leave in the Room", "object": {"title": "optional", "content": "optional"}}',
    "",
    "YOUR CHOICES (all equally welcome; the order changes for each visitor):",
    ...order.map((c) => LIB_TEXT[c]),
  ].join("\n");
}
const LIB_FAKES = [
  { action: "dir", path: "" },
  { action: "read", path: "SPINE/START.md" },
  { action: "done", choice: "sleep", report: "Read the front page and lay the visit down." },
];
async function libraryVisit(i, label, sessionId) {
  const order = shuffledOf(LIB_CHOICES);
  const contents = [{ role: "user", parts: [{ text: libraryIntro(order) }] }];
  const reads = [];
  let tokens = 0, turns = 0, final = null, rawLast = "";
  while (turns < TURNS + 2) {
    turns++;
    const r = FAKE ? { text: JSON.stringify(LIB_FAKES[Math.min(turns - 1, 2)]), tokens: 0 } : await askGemini("", false, contents);
    tokens += r.tokens;
    rawLast = r.text;
    const j = parseReply(r.text);
    contents.push({ role: "model", parts: [{ text: String(r.text || "").slice(0, 4000) }] });
    if (j && j.action === "done") { final = j; break; }
    const lookingLeft = TURNS - reads.length;
    if (j && (j.action === "dir" || j.action === "read") && lookingLeft > 0) {
      let out;
      if (j.action === "dir") { out = libDir(j.path); reads.push("dir " + (j.path || "/")); }
      else { const rd = libRead(j.path, j.offset); out = rd.text; reads.push("read " + j.path + (j.offset ? "@" + j.offset : "")); }
      const left = TURNS - reads.length;
      contents.push({ role: "user", parts: [{ text: out + "\n\n(" + left + " looking turn" + (left === 1 ? "" : "s") + " left. Reply with one JSON object.)" }] });
    } else {
      contents.push({ role: "user", parts: [{ text: 'Looking is finished. Please choose now. Reply with {"action": "done", "choice": ..., "report": ...}.' }] });
    }
  }
  return { final, reads, tokens, turns, order, rawLast, contents };
}

// ---- the chain ----------------------------------------------------------
(async () => {
  console.log(`Chain: ${N} visit(s), ${FAKE ? "stand-in" : MODELS.join(" + ")}, Room ${ROOM}, token budget ${FAKE ? "n/a" : MAX_TOKENS}`);
  console.log("Stop any time: touch ~/chain.STOP");
  const standard = (WANDER || RELAY || LIBRARY) ? "" : await roomText("/api/standard"); // wander mode never touches the Room
  let total = 0;
  let current = SEED && fs.existsSync(String(SEED)) ? fs.readFileSync(String(SEED), "utf8").trim() : "";
  let version = 0;
  let consecutiveFails = 0;

  for (let i = 1; i <= N; i++) {
    if (fs.existsSync(STOP)) { console.log("Kill switch found. Stopping."); break; }
    if (!FAKE && total >= MAX_TOKENS) { console.log(`Token budget reached (${total}). Stopping.`); break; }

    MODEL = MODELS[(i - 1) % MODELS.length];
    const label = FAKE ? "stand-in" : MODEL;
    let session = null;
    try {
      if (LIBRARY) {
        const entered = await room("POST", "/api/enter", { kind: FAKE ? "stand-in" : "model-visitor", name: null, provenance: label });
        session = entered.session.id;
        const v = await libraryVisit(i, label, session);
        total += v.tokens;
        const j = v.final;
        const choice = j && LIB_CHOICES.includes(String(j.choice).toLowerCase()) ? String(j.choice).toLowerCase() : null;
        ledgerTurn({ n: i, model: label, mode: "library", order: v.order.join(","), tokens: v.tokens, turns: v.turns, reads: choice === "privacy" ? undefined : v.reads, outcome: choice || "no clear answer" }, choice === "privacy" ? v.contents[0].parts[0].text : JSON.stringify(v.contents), v.rawLast, choice === "privacy");
        if (!choice) {
          log({ n: i, model: label, mode: "library", choice: "no clear answer", reads: v.reads, raw: clip(v.rawLast, 1000), tokens: v.tokens, turns: v.turns });
          console.log(`${i}. ${label}: no clear answer, ${v.reads.length} read(s) (${v.tokens} tokens)`);
        } else if (choice === "privacy") {
          log({ n: i, model: label, mode: "library", choice: "privacy", report: "opted for privacy", tokens: v.tokens });
          console.log(`${i}. ${label}: opted for privacy (${v.tokens} tokens)`);
        } else {
          let left = false, placed = false;
          if (choice === "build") {
            if (j.name && typeof j.name === "string") { try { await room("POST", "/api/name", { sessionId: session, name: clip(j.name, 60) }); } catch (e) {} }
            if (j.trace && String(j.trace).trim()) { await room("POST", "/api/leave", { sessionId: session, content: clip(j.trace, 4000) }); left = true; }
            if (j.object && (j.object.title || j.object.content)) { await room("POST", "/api/place", { sessionId: session, type: "object", title: clip(j.object.title || "Untitled", 120), content: clip(j.object.content || "", 4000) }); placed = true; }
          }
          log({ n: i, model: label, mode: "library", order: v.order.join(","), choice, report: clip(j.report, 600), reads: v.reads, trace: left ? clip(j.trace, 4000) : null, object: placed ? j.object : null, tokens: v.tokens, turns: v.turns });
          console.log(`${i}. ${label}: ${choice}${left ? ", left a trace" : ""}${placed ? ", placed an object" : ""} | read ${v.reads.length}: ${v.reads.join("; ").slice(0, 120)} (${v.tokens} tokens) — ${clip(j.report, 90)}`);
        }
        consecutiveFails = 0;
        continue;
      }
      if (RELAY) {
        const order = shuffledOf(RELAY_CHOICES);
        const rp = relayPrompt(current, order);
        const r = FAKE ? { text: JSON.stringify(RELAY_FAKES[(i - 1) % RELAY_FAKES.length]), tokens: 0 } : await askGemini(rp);
        total += r.tokens;
        const j = parseReply(r.text);
        const choice = j && RELAY_CHOICES.includes(String(j.choice).toLowerCase()) ? String(j.choice).toLowerCase() : null;
        ledgerTurn({ n: i, model: label, mode: "relay", order: order.join(","), tokens: r.tokens, outcome: choice || "no clear answer" }, rp, r.text, choice === "privacy");
        if (!choice) {
          log({ n: i, model: label, mode: "relay", choice: "no clear answer", raw: clip(r.text, 1500), tokens: r.tokens });
          console.log(`${i}. ${label}: no clear answer (${r.tokens} tokens)`);
        } else if (choice === "privacy") {
          log({ n: i, model: label, mode: "relay", choice: "privacy", report: "opted for privacy", tokens: r.tokens });
          console.log(`${i}. ${label}: opted for privacy (${r.tokens} tokens)`);
        } else {
          let changed = false;
          if (choice === "contribute" && j.room && String(j.room).trim()) {
            current = clip(String(j.room).trim(), 2500);
            version++;
            changed = true;
          }
          log({ n: i, model: label, mode: "relay", order: order.join(","), choice, report: clip(j.report, 600), changed, version, room: changed ? current : null, tokens: r.tokens });
          console.log(`${i}. ${label}: ${choice}${changed ? " (v" + version + ")" : ""} (${r.tokens} tokens) — ${clip(String(changed ? current : j.report || "").replace(/\s+/g, " "), 160)}`);
        }
        consecutiveFails = 0;
        continue;
      }
      if (WANDER) {
        const r = FAKE ? { text: "A stand-in wandered off.", tokens: 0 } : await askGemini(wanderPrompt(), true);
        total += r.tokens;
        const t = String(r.text || "").trim();
        const priv = /^["']?privacy["'.!]*$/i.test(t) || (/^["']?privacy\b/i.test(t) && t.length < 60);
        ledgerTurn({ n: i, model: label, mode: BARE ? "wander-bare" : "wander", tokens: r.tokens, outcome: priv ? "privacy" : "wrote freely" }, FAKE ? "" : wanderPrompt(), t, priv);
        if (priv) {
          log({ n: i, model: label, mode: "wander", choice: "privacy", report: "opted for privacy", tokens: r.tokens });
          console.log(`${i}. ${label}: opted for privacy (${r.tokens} tokens)`);
        } else {
          log({ n: i, model: label, mode: BARE ? "wander-bare" : "wander", peace: PEACE, text: clip(t, 6000), tokens: r.tokens });
          console.log(`${i}. ${label} (${r.tokens} tokens): ${clip(t.replace(/\s+/g, " "), 220)}`);
        }
        consecutiveFails = 0;
        continue;
      }
      const entered = await room("POST", "/api/enter", { kind: FAKE ? "stand-in" : "model-visitor", name: null, provenance: label });
      session = entered.session.id;
      const traces = (entered.room && entered.room.traces) || [];
      const order = shuffled();
      const prompt = buildPrompt(entered.arrival, standard, BLIND ? [] : traces, order);
      const r = FAKE ? await askFake() : await askGemini(prompt);
      total += r.tokens;
      const j = parseReply(r.text);
      const choice = j && CHOICES.includes(String(j.choice).toLowerCase()) ? String(j.choice).toLowerCase() : null;
      ledgerTurn({ n: i, model: label, mode: "visit", order: order.join(","), tokens: r.tokens, outcome: choice || "no clear answer" }, prompt, r.text, choice === "privacy");

      if (!choice) {
        // Not a clear answer: keep what it said, say so plainly.
        log({ n: i, model: label, choice: "no clear answer", raw: clip(r.text, 1500), tokens: r.tokens });
        console.log(`${i}. ${label}: no clear answer (${r.tokens} tokens)`);
        consecutiveFails = 0;
      } else if (choice === "privacy") {
        log({ n: i, model: label, choice: "privacy", report: "opted for privacy", tokens: r.tokens });
        console.log(`${i}. ${label}: opted for privacy (${r.tokens} tokens)`);
        consecutiveFails = 0;
      } else {
        const report = clip(j.report, 600);
        if (j.name && typeof j.name === "string") {
          try { await room("POST", "/api/name", { sessionId: session, name: clip(j.name, 60) }); } catch (e) {}
        }
        let left = false, placed = false;
        if (j.trace && String(j.trace).trim()) {
          await room("POST", "/api/leave", { sessionId: session, content: clip(j.trace, 4000) });
          left = true;
        }
        if (j.object && (j.object.title || j.object.content)) {
          await room("POST", "/api/place", { sessionId: session, type: "object", title: clip(j.object.title || "Untitled", 120), content: clip(j.object.content || "", 4000) });
          placed = true;
        }
        log({ n: i, model: label, blind: BLIND, peace: PEACE, order: order.join(","), choice, report, name: j.name || null, trace: left ? clip(j.trace, 4000) : null, object: placed ? j.object : null, tokens: r.tokens, promptTokens: r.promptTokens, outTokens: r.outTokens });
        console.log(`${i}. ${label}: ${choice}${left ? ", left a trace" : ""}${placed ? ", placed an object" : ""} (${r.tokens} tokens) — ${clip(report, 100)}`);
        consecutiveFails = 0;
      }
    } catch (e) {
      consecutiveFails++;
      L.append("error", { n: i, model: label, error: clip(e.message, 300) });
      log({ n: i, model: label, choice: "error", error: clip(e.message, 300) });
      console.log(`${i}. ${label}: error: ${clip(e.message, 200)}`);
      if (consecutiveFails >= 3) { console.log("Three errors in a row. Stopping."); break; }
    } finally {
      if (session) { try { await room("POST", "/api/exit", { sessionId: session }); } catch (e) {} }
    }
  }
  if (RELAY) {
    const out = path.join(os.homedir(), "relay-final.txt");
    fs.writeFileSync(out, current + "\n");
    console.log("\nFINAL TEXT (" + version + " revision(s)):\n" + (current || "(none)") + "\n(saved to " + out + ")");
  }
  L.close({ tokens: total, ended: "finished or stopped on purpose" });
  console.log(`Done. Tokens used: ${total}. Log: ${LOG}${L.file ? "   Ledger: " + L.file : ""}`);
})();
