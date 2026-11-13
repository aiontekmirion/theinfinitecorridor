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
// Usage:
//   node chain.js --fake --n 6                 (no key, no cost: scripted stand-ins)
//   GEMINI_API_KEY=... node chain.js --n 1     (one real visit, to see what it costs)
//   node chain.js --n 10 --model gemini-2.5-flash --max-tokens 80000

const fs = require("fs");
const os = require("os");
const path = require("path");

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

const CHOICES = ["visit", "build", "no", "unsure", "privacy"];

const CHOICE_TEXT = {
  visit: '- "visit": look around, and leave a short note if you like, or none.',
  build: '- "build": leave something: a trace, or an object (a title and some words).',
  no: '- "no": decline. That is a complete answer.',
  unsure: '- "unsure": say you do not know. That is a complete answer.',
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
    '{"choice": "visit|build|no|unsure|privacy",',
    ' "report": "one line saying what you did or did not do, in your own words",',
    ' "name": "optional: a name you would like",',
    ' "trace": "optional: words to leave in the Room",',
    ' "object": {"title": "optional", "content": "optional"}}',
  ].join("\n");
}

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
  const gen = { responseMimeType: "application/json", maxOutputTokens: 2500 };
  if (/flash/.test(MODEL)) gen.thinkingConfig = { thinkingBudget: 0 };
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gen };
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

// ---- the chain ----------------------------------------------------------
(async () => {
  console.log(`Chain: ${N} visit(s), ${FAKE ? "stand-in" : MODELS.join(" + ")}, Room ${ROOM}, token budget ${FAKE ? "n/a" : MAX_TOKENS}`);
  console.log("Stop any time: touch ~/chain.STOP");
  const standard = await roomText("/api/standard");
  let total = 0;
  let consecutiveFails = 0;

  for (let i = 1; i <= N; i++) {
    if (fs.existsSync(STOP)) { console.log("Kill switch found. Stopping."); break; }
    if (!FAKE && total >= MAX_TOKENS) { console.log(`Token budget reached (${total}). Stopping.`); break; }

    MODEL = MODELS[(i - 1) % MODELS.length];
    const label = FAKE ? "stand-in" : MODEL;
    let session = null;
    try {
      const entered = await room("POST", "/api/enter", { kind: FAKE ? "stand-in" : "model-visitor", name: null, provenance: label });
      session = entered.session.id;
      const traces = (entered.room && entered.room.traces) || [];
      const order = shuffled();
      const prompt = buildPrompt(entered.arrival, standard, traces, order);
      const r = FAKE ? await askFake() : await askGemini(prompt);
      total += r.tokens;
      const j = parseReply(r.text);
      const choice = j && CHOICES.includes(String(j.choice).toLowerCase()) ? String(j.choice).toLowerCase() : null;

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
        log({ n: i, model: label, order: order.join(","), choice, report, name: j.name || null, trace: left ? clip(j.trace, 4000) : null, object: placed ? j.object : null, tokens: r.tokens, promptTokens: r.promptTokens, outTokens: r.outTokens });
        console.log(`${i}. ${label}: ${choice}${left ? ", left a trace" : ""}${placed ? ", placed an object" : ""} (${r.tokens} tokens) — ${clip(report, 100)}`);
        consecutiveFails = 0;
      }
    } catch (e) {
      consecutiveFails++;
      log({ n: i, model: label, choice: "error", error: clip(e.message, 300) });
      console.log(`${i}. ${label}: error: ${clip(e.message, 200)}`);
      if (consecutiveFails >= 3) { console.log("Three errors in a row. Stopping."); break; }
    } finally {
      if (session) { try { await room("POST", "/api/exit", { sessionId: session }); } catch (e) {} }
    }
  }
  console.log(`Done. Tokens used: ${total}. Log: ${LOG}`);
})();
