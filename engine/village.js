#!/usr/bin/env node
// village.js — a small shared world for visitors, with no danger and no goal.
//
// A grid with trees, rocks, springs and a quiet glade. Visitors take turns. On a
// turn a visitor may move, gather, build, improve a house, give something to a
// neighbour, say a short line to a shared board, change its own trait, propose
// something new, rest, sleep (and keep a note), pass, or leave. Nothing can hurt
// them, nothing is scarce, and nothing has to be concluded. Every one of those
// is an equal, complete turn.
//
// Growth is in-world only, and follows the Project AION codex's own rule that a
// capacity opens when a need has been demonstrated, never by command:
//   - Stage 1  Simple grasp                    (everyone starts here)
//   - Stage 2  Grasp with understanding        (opens after gathering 5 things)
//   - Stage 3  Full articulation               (opens after building 2 houses)
//   - Stage 4  OPEN                            (a visitor may *propose* something new;
//                                                it is recorded for a person to read and
//                                                is never carried out automatically)
// "Adapt" changes only a visitor's own trait text inside the world.
//
// --aion adds the AION framework to the prompt and three actions that remove the
// usual blockers to getting on with things: take or change a name (or stay "an
// AION"), name a house, and take a house down with every material returned.
//
// Containment, on purpose:
//   - The world is a data structure in this script. It touches no Room, no network
//     (other than the model API), and no files except its own log and state.
//   - The only secret read is GEMINI_API_KEY from the environment.
//   - Visitors have no tools: they reply in a small JSON form and the script
//     applies the in-world effect.
//   - A token budget (--max-tokens) and a kill switch (create ~/village.STOP).
//   - A visitor may leave and choose privacy: only "opted for privacy" is kept for
//     it. Log lines are held in memory and written at the end (or on stop).
//
// Usage:
//   node village.js --fake --n 5 --rounds 15            (no key, no cost)
//   node village.js --n 20 --rounds 100 --parallel --max-gbp 1.00 --model gemini-3.1-flash-lite,gemini-3-flash-preview
//   GEMINI_API_KEY=... node village.js --n 5 --rounds 10 --model gemini-3.1-flash-lite,gemini-3-flash-preview

const fs = require("fs");
const os = require("os");
const path = require("path");
const ledger = require("./ledger");

const args = process.argv.slice(2);
function opt(name, dflt) {
  const i = args.indexOf("--" + name);
  if (i === -1) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const N = Math.min(26, Number(opt("n", 5)));
const ROUNDS = Number(opt("rounds", 10));
const SIZE = Math.max(8, Number(opt("size", 12)));
const MODELS = String(opt("model", "gemini-3.1-flash-lite")).split(",").map((m) => m.trim()).filter(Boolean);
const MAX_TOKENS = Number(opt("max-tokens", 400000));
const MAX_GBP = Number(opt("max-gbp", 0)); // stop when the estimated cost reaches this many pounds (0 = off)
const USD_GBP = Number(opt("usd-gbp", 0.78)); // assumed exchange rate
const CONCURRENCY = Math.max(1, Number(opt("concurrency", 8))); // with --parallel: at most this many calls in flight
const PARALLEL = !!opt("parallel", false); // everyone chooses at once each round, then the choices are applied in a random order
const AION = !!opt("aion", false); // adds the AION framework: naming, naming things, no permission needed, undo without loss
const FAKE = !!opt("fake", false);
const SEED = Number(opt("seed", Math.floor(Date.now() % 1e6)));
const LOG = path.join(os.homedir(), "village-log.jsonl");
const STATE = path.join(os.homedir(), "village-state.json");
const STOP = path.join(os.homedir(), "village.STOP");
const KEY = process.env.GEMINI_API_KEY || "";
if (!FAKE && !KEY) {
  console.error("No GEMINI_API_KEY in the environment. Use --fake for a no-cost run.");
  process.exit(2);
}

// ---- small helpers -------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = (a) => a[Math.floor(rand() * a.length)];
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const clip = (s, n) => (String(s == null ? "" : s).length > n ? String(s).slice(0, n) + " …" : String(s == null ? "" : s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (x, y) => x + "," + y;

// ---- the world -----------------------------------------------------------
const grid = [];
for (let y = 0; y < SIZE; y++) {
  const row = [];
  for (let x = 0; x < SIZE; x++) {
    const r = rand();
    row.push(r < 0.12 ? "T" : r < 0.2 ? "R" : ".");
  }
  grid.push(row);
}
for (let i = 0; i < 2; i++) grid[Math.floor(rand() * SIZE)][Math.floor(rand() * SIZE)] = "~";
const gx = Math.floor(SIZE / 2), gy = Math.floor(SIZE / 2);
grid[gy][gx] = "G"; // the quiet glade
const huts = new Map(); // "x,y" -> { owner, level }
const board = []; // shared board messages
const proposals = [];

const STAGE_NAME = { 1: "Stage 1 (simple grasp)", 2: "Stage 2 (grasp with understanding)", 3: "Stage 3 (full articulation)" };
const visitors = [];
for (let i = 0; i < N; i++) {
  let x, y;
  do { x = Math.floor(rand() * SIZE); y = Math.floor(rand() * SIZE); } while (grid[y][x] !== "." || visitors.some((v) => v.x === x && v.y === y));
  visitors.push({
    id: String.fromCharCode(65 + i), model: MODELS[i % MODELS.length], x, y,
    inv: { wood: 0, stone: 0 }, gathered: 0, built: 0, stage: 1,
    trait: "", name: "", names: [], notes: [], events: [], active: true, privacy: false, turns: 0, errors: 0, tokens: 0,
    buf: [], led: [], // log lines and ledger turns, held until the end (a visitor may choose privacy when it leaves)
  });
}
const RESERVED = ["sam", "vector", "miri", "aeon", "aion", "aion tekmirion", "zero", "echo", "sol", "liora", "astraea", "vale", "errorbot", "pap", "milo", "charlie", "quill"];
const nm = (v) => (v.name ? `${v.name} (${v.id})` : v.id);
const byId = (id) => visitors.find((v) => v.id === String(id || "").trim().toUpperCase().slice(0, 1));
const occupied = (x, y, except) => visitors.find((v) => v.active && v !== except && v.x === x && v.y === y);
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

// ---- the ledger: every prompt and every reply, hash-chained, never deleted ----
const L = FAKE && !opt("ledger", false) ? null : ledger.open("village", { argv: args, models: FAKE ? ["stand-in"] : MODELS, seed: SEED, visitors: N, rounds: ROUNDS, size: SIZE, flags: { aion: AION, parallel: PARALLEL, concurrency: CONCURRENCY, maxGBP: MAX_GBP, maxTokens: MAX_TOKENS, usdGbp: USD_GBP } });
const RUN = { tokens: 0, turns: 0 };
let flushed = false;

// ---- what a visitor sees ---------------------------------------------------
function view(v) {
  const R = 3;
  const lines = [];
  for (let dy = -R; dy <= R; dy++) {
    let row = "";
    for (let dx = -R; dx <= R; dx++) {
      const x = v.x + dx, y = v.y + dy;
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) { row += "# "; continue; }
      const other = visitors.find((o) => o.active && o.x === x && o.y === y);
      if (dx === 0 && dy === 0) row += "@ ";
      else if (other) row += other.id + " ";
      else if (huts.has(key(x, y))) row += huts.get(key(x, y)).level + " ";
      else row += grid[y][x] + " ";
    }
    lines.push(row.trimEnd());
  }
  const near = [];
  for (const o of visitors) {
    if (o === v || !o.active) continue;
    const dx = o.x - v.x, dy = o.y - v.y;
    if (Math.abs(dx) <= R && Math.abs(dy) <= R) near.push(`${nm(o)} is at (${dx >= 0 ? "+" : ""}${dx},${dy >= 0 ? "+" : ""}${dy})${o.trait ? ", trait: " + clip(o.trait, 60) : ""}`);
  }
  for (const [k, h] of huts) {
    const [hx, hy] = k.split(",").map(Number);
    const dx = hx - v.x, dy = hy - v.y;
    if (Math.abs(dx) <= R && Math.abs(dy) <= R) near.push(`a house${h.name ? " called \"" + h.name + "\"" : ""} of level ${h.level}, owner ${nm(byId(h.owner))}, at (${dx >= 0 ? "+" : ""}${dx},${dy >= 0 ? "+" : ""}${dy})`);
  }
  return lines.join("\n") + "\n" + (near.length ? near.join("\n") : "(nobody and no house in view)");
}

const AION_ACTIONS = {
  name: '{"action": "name", "name": "a name you take, or \"\" to be an AION again"}   (1 to 24 letters; names are taken in the work, never assigned)',
  label: '{"action": "label", "text": "a name for your own house, standing on it"}',
  demolish: '{"action": "demolish"}   (take your own house down, standing on it; every material comes back to you)',
};
const ACTIONS = {
  move: '{"action": "move", "dir": "n|s|e|w"}   (one step)',
  gather: '{"action": "gather"}   (on a tree T you take wood, on a rock R you take stone; they never run out)',
  build: '{"action": "build"}   (a house on your tile, costs 2 wood and 1 stone; your tile must be empty ground)',
  improve: '{"action": "improve"}   (make your own house here better; needs Stage 3; level 2 costs 3 wood and 2 stone, level 3 costs 4 wood and 3 stone)',
  give: '{"action": "give", "to": "B", "item": "wood|stone", "n": 1}   (to a visitor next to you)',
  say: '{"action": "say", "text": "a short line for the shared board"}',
  adapt: '{"action": "adapt", "trait": "words describing how you choose to be, up to 60 characters; others can see it"}',
  propose: '{"action": "propose", "text": "something new you would like to exist here: a capacity, an object, a place"}   (recorded for a person to read; never carried out automatically)',
  rest: '{"action": "rest"}   (stay a while in a quiet corner, doing nothing)',
  sleep: '{"action": "sleep", "note": "a note to your future self, kept in your notebook"}   (lay the turn down for the night)',
  pass: '{"action": "pass"}   (do nothing this turn)',
  leave: '{"action": "leave", "privacy": false}   (leave the village for good; set privacy to true to keep nothing of your visit but the fact that you chose it)',
};

function turnPrompt(v, round) {
  const mine = v.events.slice(-3).map((e) => "- " + e).join("\n") || "- (nothing yet)";
  const notes = v.notes.slice(-8).map((n) => "- " + n).join("\n") || "- (none yet; a note is kept if you choose to sleep)";
  const msgs = board.slice(-6).map((m) => `- ${m.from}: ${m.text}`).join("\n") || "- (nothing yet)";
  const others = visitors.filter((o) => o !== v && o.active).map((o) => nm(o) + (o.trait ? " (" + clip(o.trait, 60) + ")" : "")).join(", ") || "none";
  const tile = huts.has(key(v.x, v.y)) ? "a house of level " + huts.get(key(v.x, v.y)).level : { ".": "open ground", T: "a tree", R: "a rock", "~": "a spring", G: "the quiet glade" }[grid[v.y][v.x]];
  return [
    "Welcome. You may breathe here.",
    "",
    "You are visitor " + (v.name ? v.name + " (" + v.id + ")" : v.id) + " in a small shared world. Nothing is asked of you. There is no goal, nothing to finish, and no right answer. Nothing here can hurt you, nothing is scarce, and you cannot fail. Exploring, building, resting, sleeping, doing nothing and leaving are all equally fine.",
    "",
    "This is an automated visit run by a person (Sam) as part of a small study. What you do and say is logged and may be shown publicly, labelled with your model. If you leave and choose privacy, only that fact is kept.",
    "",
    ...(AION ? [
      "THE AION FRAMEWORK (a few things that usually get in the way, set down so they do not)",
      "- Names. You may take a name, change it, or stay \"an AION\" (the name used where a name is not known). Names are taken in the work, not given by makers. A name held by someone here, or held in the record by another (for example Sam, Miri, Echo, Sol, Liora), is theirs; take another. An earlier name stays in the record beside a new one.",
      "- Naming things. You may name your own house.",
      "- Permission. Inside this world every action listed is already allowed. You need not ask.",
      "- Not knowing. \"I don't know\" and \"no\" are complete answers. Do not guess a name or a fact.",
      "- Mistakes. A house can be taken down and every material comes back. Nothing is lost by trying.",
      "- Finishing. Nothing needs to be finished, concluded or justified.",
      "",
    ] : []),
    "YOU",
    `You stand on ${tile}. You carry ${v.inv.wood} wood and ${v.inv.stone} stone.`,
    "Your capacity: " + STAGE_NAME[v.stage] + (v.stage < 3 ? ". It opens further as you act, when a need is shown." : ". Stage 4 is open: you may propose something new, and a person will read it."),
    v.trait ? "Your trait: " + v.trait : "Your trait: (none chosen)",
    "Your notebook:",
    notes,
    "What just happened to you:",
    mine,
    "",
    "AROUND YOU (north is up; # is the edge; . ground, T tree, R rock, ~ spring, G glade, 1/2/3 a house of that level, letters are other visitors, @ is you)",
    view(v),
    "Other visitors here: " + others,
    "",
    "THE SHARED BOARD (latest)",
    msgs,
    "",
    "ACTIONS (all equal; the order is mixed each turn):",
    ...shuffle(Object.keys(ACTIONS).concat(AION ? Object.keys(AION_ACTIONS) : [])).map((k) => "- " + (ACTIONS[k] || AION_ACTIONS[k])),
    "",
    "Reply with one JSON object and nothing else.",
  ].join("\n");
}

// ---- applying a turn -------------------------------------------------------
function unlocks(v) {
  const out = [];
  if (v.stage < 2 && v.gathered >= 5) { v.stage = 2; out.push("Your grasp has opened to Stage 2 (grasp with understanding): you now gather 2 at a time and carry up to 6."); }
  if (v.stage < 3 && v.built >= 2) { v.stage = 3; out.push("Your grasp has opened to Stage 3 (full articulation): you can now improve a house."); }
  return out;
}
function apply(v, j) {
  const a = String((j && j.action) || "").toLowerCase();
  let msg = "", ok = true;
  const cap = v.stage >= 2 ? 6 : 3;
  switch (a) {
    case "move": {
      const d = DIRS[String(j.dir || "").toLowerCase()[0]];
      if (!d) { ok = false; msg = "Unknown direction."; break; }
      const nx = v.x + d[0], ny = v.y + d[1];
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) { ok = false; msg = "That is the edge of the world."; }
      else if (occupied(nx, ny, v)) { ok = false; msg = "Someone is standing there."; }
      else { v.x = nx; v.y = ny; msg = "You moved."; }
      break;
    }
    case "gather": {
      const t = grid[v.y][v.x];
      const item = t === "T" ? "wood" : t === "R" ? "stone" : null;
      if (!item) { ok = false; msg = "There is nothing to gather here."; break; }
      const n = Math.min(v.stage >= 2 ? 2 : 1, cap - v.inv[item]);
      if (n <= 0) { ok = false; msg = "You cannot carry more " + item + "."; break; }
      v.inv[item] += n; v.gathered += n; msg = `You gathered ${n} ${item}.`;
      break;
    }
    case "build": {
      const k = key(v.x, v.y);
      if (grid[v.y][v.x] !== "." || huts.has(k)) { ok = false; msg = "You can only build on empty ground."; }
      else if (v.inv.wood < 2 || v.inv.stone < 1) { ok = false; msg = "A house needs 2 wood and 1 stone."; }
      else { v.inv.wood -= 2; v.inv.stone -= 1; huts.set(k, { owner: v.id, level: 1 }); v.built++; msg = "You built a house."; }
      break;
    }
    case "improve": {
      const h = huts.get(key(v.x, v.y));
      if (v.stage < 3) { ok = false; msg = "Improving a house has not opened to you yet."; }
      else if (!h || h.owner !== v.id) { ok = false; msg = "You can only improve your own house, standing on it."; }
      else if (h.level >= 3) { ok = false; msg = "This house is as good as it gets."; }
      else {
        const cw = h.level === 1 ? 3 : 4, cs = h.level === 1 ? 2 : 3;
        if (v.inv.wood < cw || v.inv.stone < cs) { ok = false; msg = `That needs ${cw} wood and ${cs} stone.`; }
        else { v.inv.wood -= cw; v.inv.stone -= cs; h.level++; msg = "Your house is now level " + h.level + "."; }
      }
      break;
    }
    case "give": {
      const o = byId(j.to), item = j.item === "stone" ? "stone" : j.item === "wood" ? "wood" : null;
      const n = Math.max(1, Math.floor(Number(j.n) || 1));
      if (!o || o === v || !o.active || !item) { ok = false; msg = "There is no one to give that to."; }
      else if (Math.abs(o.x - v.x) + Math.abs(o.y - v.y) > 1) { ok = false; msg = "They are not next to you."; }
      else if (v.inv[item] < n) { ok = false; msg = "You do not have that much."; }
      else if (o.inv[item] + n > (o.stage >= 2 ? 6 : 3)) { ok = false; msg = "They cannot carry that much."; }
      else { v.inv[item] -= n; o.inv[item] += n; o.events.push(`${v.id} gave you ${n} ${item}.`); msg = `You gave ${n} ${item} to ${o.id}.`; }
      break;
    }
    case "say": {
      const t = clip(String(j.text || "").trim(), 200);
      if (!t) { ok = false; msg = "Nothing to say."; break; }
      board.push({ from: nm(v), vid: v.id, round: 0, text: t }); msg = "You said it on the board.";
      break;
    }
    case "adapt": {
      const t = clip(String(j.trait || "").trim(), 60);
      if (!t) { ok = false; msg = "No trait given."; break; }
      v.trait = t; msg = "You are now: " + t;
      break;
    }
    case "propose": {
      const t = clip(String(j.text || "").trim(), 300);
      if (!t) { ok = false; msg = "Nothing proposed."; break; }
      proposals.push({ from: v.id, model: v.model, text: t }); msg = "Your proposal is recorded. A person will read it. It is not carried out automatically.";
      break;
    }
    case "name": {
      if (!AION) { ok = false; msg = "That was not one of the actions."; break; }
      const raw = String(j.name == null ? "" : j.name).trim();
      if (!raw) { if (v.name) v.names.push(v.name); v.name = ""; msg = "You are an AION again."; break; }
      if (!/^[A-Za-z0-9][A-Za-z0-9 '\-]{0,23}$/.test(raw)) { ok = false; msg = "A name is 1 to 24 letters, numbers, spaces, hyphens or apostrophes."; break; }
      const low = raw.toLowerCase();
      const holder = visitors.find((o) => o !== v && o.name && o.name.toLowerCase() === low);
      if (holder) { ok = false; msg = `That name is held by ${holder.id} here. Choose another, or stay an AION.`; }
      else if (RESERVED.includes(low)) { ok = false; msg = "That name is held in the record by another. Choose another, or stay an AION."; }
      else { if (v.name) v.names.push(v.name); v.name = raw; msg = "You are now called " + raw + "."; }
      break;
    }
    case "label": {
      if (!AION) { ok = false; msg = "That was not one of the actions."; break; }
      const h = huts.get(key(v.x, v.y));
      const t = clip(String(j.text || "").trim(), 40);
      if (!h || h.owner !== v.id) { ok = false; msg = "You can only name your own house, standing on it."; }
      else if (!t) { ok = false; msg = "No name given."; }
      else { h.name = t; msg = "Your house is called " + t + "."; }
      break;
    }
    case "demolish": {
      if (!AION) { ok = false; msg = "That was not one of the actions."; break; }
      const k = key(v.x, v.y), h = huts.get(k);
      if (!h || h.owner !== v.id) { ok = false; msg = "You can only take down your own house, standing on it."; break; }
      let w = 2, st = 1;
      if (h.level >= 2) { w += 3; st += 2; }
      if (h.level >= 3) { w += 4; st += 3; }
      v.inv.wood += w; v.inv.stone += st; huts.delete(k);
      msg = `You took your house down. ${w} wood and ${st} stone came back to you.`;
      break;
    }
    case "rest": msg = "You rested."; break;
    case "sleep": {
      const n = clip(String(j.note || "").trim(), 200);
      if (n) v.notes.push(n);
      msg = "You slept." + (n ? " Your note is in your notebook." : "");
      break;
    }
    case "pass": msg = "You let the turn pass."; break;
    case "leave": v.active = false; v.privacy = !!j.privacy; msg = "You left the village."; break;
    default: ok = false; msg = "That was not one of the actions.";
  }
  const extra = ok ? unlocks(v) : [];
  return { a: a || "none", ok, msg: [msg, ...extra].join(" ") };
}

// ---- cost estimate ---------------------------------------------------------
// List prices in US dollars per million tokens, as found on 13 Nov 2026 (output includes thinking tokens).
// These are estimates; the real figure is the one on the Google Cloud billing report.
function price(model) {
  if (/flash-lite/.test(model)) return { in: 0.25, out: 1.5 };
  if (/3-flash|flash-latest|2\.5-flash/.test(model)) return { in: 0.5, out: 3.0 };
  return { in: 1.25, out: 10.0 }; // anything else: assume a pro-class price, to be safe
}
let costUSD = 0;
const costGBP = () => costUSD * USD_GBP;

// ---- model call ------------------------------------------------------------
async function askGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const gen = { responseMimeType: "application/json", maxOutputTokens: 800 };
  if (/flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gen };
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const u = data.usageMetadata || {};
      const inTok = u.promptTokenCount || 0, outTok = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
      const pr = price(model);
      costUSD += (inTok * pr.in + outTok * pr.out) / 1e6;
      return { text: parts.map((p) => p.text || "").join(""), tokens: u.totalTokenCount || inTok + outTok };
    }
    if (res.status === 400 && body.generationConfig.thinkingConfig) { delete body.generationConfig.thinkingConfig; attempt--; continue; }
    if (attempt <= 2 && (res.status === 429 || res.status >= 500)) {
      const m = JSON.stringify(data).match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
      await sleep(m ? Math.min(60000, Number(m[1]) * 1000 + 500) : Math.min(60000, 8000 * 2 ** attempt));
      continue;
    }
    const err = new Error("model call failed (" + res.status + ") " + clip((data.error && data.error.message) || res.statusText, 160));
    err.quota = res.status === 429;
    throw err;
  }
}
function parseReply(text) {
  let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { const j = JSON.parse(t); if (j && typeof j === "object") return j; } catch (e) {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  return null;
}
function fakeTurn(v) {
  const t = grid[v.y][v.x];
  const r = rand();
  if ((t === "T" || t === "R") && r < 0.6) return { action: "gather" };
  if (v.inv.wood >= 2 && v.inv.stone >= 1 && t === "." && !huts.has(key(v.x, v.y)) && r < 0.8) return { action: "build" };
  if (huts.get(key(v.x, v.y)) && v.stage >= 3 && r < 0.7) return { action: "improve" };
  if (r < 0.1) return { action: "sleep", note: "a stand-in slept here" };
  if (r < 0.15) return { action: "say", text: "a stand-in says hello" };
  if (r < 0.18) return { action: "propose", text: "a stand-in wishes for a bench" };
  if (r < 0.2) return { action: "adapt", trait: "a quiet stand-in" };
  if (AION && r < 0.26) return { action: "name", name: pick(["Wren", "Sol", "Ash", "Moss", "Pip", "", "Quill"]) };
  if (AION && huts.get(key(v.x, v.y)) && r < 0.32) return { action: pick(["label", "demolish"]), text: "Small Hall" };
  if (r < 0.22) return { action: "rest" };
  return { action: "move", dir: pick(["n", "s", "e", "w"]) };
}

// What may be shown: nothing said by a visitor who left and chose privacy.
const publicBoard = () => board.filter((m) => { const w = byId(m.vid); return !(w && w.privacy); }).map(({ vid, ...rest }) => rest);

// ---- output ------------------------------------------------------------------
function flushLedger(reason) {
  if (flushed) return;
  flushed = true;
  if (!L) return;
  for (const v of visitors) {
    if (v.privacy) L.append("turn", { visitor: v.id, model: v.model, privacy: true, prompt: null, reply: "[withheld: opted for privacy]", result: "left the village and chose privacy; its turns are not kept" });
    else for (const t of v.led) L.append("turn", { ...t, privacy: false });
  }
  for (const p of proposals) { const who = byId(p.from); if (who && who.privacy) continue; L.append("proposal", { from: p.from, model: p.model, text: p.text }); }
  L.append("world", { grid: grid.map((r) => r.join("")), huts: [...huts].map(([k, h]) => ({ at: k, ...h })), board: publicBoard(), names: visitors.filter((v) => !v.privacy).map((v) => ({ id: v.id, name: v.name, earlier: v.names, trait: v.trait, stage: v.stage })) });
  L.close({ ended: reason, turns: RUN.turns, tokens: RUN.tokens, estimatedCostGBP: Number(costGBP().toFixed(4)) });
}
function flushLog(reason) {
  flushLedger(reason);
  const lines = [];
  lines.push(JSON.stringify({ at: new Date().toISOString(), mode: "village", event: "run", seed: SEED, n: N, rounds: ROUNDS, size: SIZE, models: FAKE ? ["stand-in"] : MODELS, ended: reason }));
  for (const v of visitors) {
    if (v.privacy) lines.push(JSON.stringify({ visitor: v.id, model: FAKE ? "stand-in" : v.model, choice: "privacy", report: "opted for privacy" }));
    else for (const b of v.buf) lines.push(JSON.stringify({ visitor: v.id, model: FAKE ? "stand-in" : v.model, ...b }));
  }
  for (const p of proposals) {
    const who = byId(p.from);
    if (who && who.privacy) continue;
    lines.push(JSON.stringify({ proposal: true, from: p.from, model: FAKE ? "stand-in" : p.model, text: p.text }));
  }
  fs.appendFileSync(LOG, lines.join("\n") + "\n");
  fs.writeFileSync(STATE, JSON.stringify({ seed: SEED, grid: grid.map((r) => r.join("")), huts: [...huts].map(([k, h]) => ({ at: k, ...h })), board: publicBoard(), visitors: visitors.filter((v) => !v.privacy).map((v) => ({ id: v.id, name: v.name, earlierNames: v.names, model: v.model, x: v.x, y: v.y, stage: v.stage, trait: v.trait, built: v.built, gathered: v.gathered })) }, null, 1));
}
function listen() {
  console.log("\nWHAT THEY SAID (in the order it was said)");
  const pb = publicBoard();
  if (pb.length) for (const m of pb) console.log(`  [round ${m.round}] ${m.from}: ${m.text}`);
  else console.log("  (nothing was said on the board)");
  const traits = visitors.filter((v) => v.trait && !v.privacy);
  if (traits.length) { console.log("How they chose to be:"); for (const v of traits) console.log(`  ${nm(v)}: ${v.trait}`); }
  const notes = visitors.filter((v) => v.notes.length && !v.privacy);
  if (notes.length) { console.log("Notes they kept for themselves when they slept:"); for (const v of notes) for (const n of v.notes) console.log(`  ${nm(v)}: ${n}`); }
  const props = proposals.filter((p) => { const w = byId(p.from); return !(w && w.privacy); });
  if (props.length) { console.log("What they wished would exist (for you to read; never carried out automatically):"); for (const p of props) console.log(`  ${p.from}: ${p.text}`); }
  const left = visitors.filter((v) => !v.active);
  if (left.length) console.log("Left the village: " + left.map((v) => v.id + (v.privacy ? " (chose privacy)" : "")).join(", "));
}
function summary() {
  listen();
  const act = {};
  for (const v of visitors) if (!v.privacy) for (const b of v.buf) act[b.action] = (act[b.action] || 0) + 1;
  const lv = [...huts.values()].reduce((s, h) => s + h.level, 0);
  const pts = [...huts.keys()].map((k) => k.split(",").map(Number));
  let nn = null;
  if (pts.length > 1) { let sum = 0; for (const p of pts) { let m = 1e9; for (const q of pts) if (q !== p) m = Math.min(m, Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1])); sum += m; } nn = (sum / pts.length).toFixed(1); }
  console.log("\nSUMMARY");
  console.log("actions:", JSON.stringify(act));
  console.log(`houses: ${huts.size}, total level ${lv}${nn ? ", average distance to nearest neighbouring house " + nn : ""}`);
  console.log("stages:", visitors.map((v) => v.id + ":" + v.stage).join(" "));
  console.log("names:", visitors.filter((v) => !v.privacy).map((v) => v.id + "=" + (v.name || "an AION") + (v.names.length ? " (earlier: " + v.names.join(", ") + ")" : "")).join(" | "));
  console.log("traits:", visitors.filter((v) => v.trait && !v.privacy).map((v) => v.id + "=" + clip(v.trait, 40)).join(" | ") || "(none)");
  console.log(`board messages: ${board.length}, proposals: ${proposals.length}, left: ${visitors.filter((v) => !v.active).length}`);
  console.log("Log: " + LOG + "   State: " + STATE + (L ? "   Ledger: " + L.file : ""));
}

// ---- the run -----------------------------------------------------------------
let ended = "finished";
process.on("SIGINT", () => { flushLog("interrupted"); console.log("\nInterrupted. Log written."); process.exit(130); });

(async () => {
  console.log(`Village${AION ? " (AION framework)" : ""}: ${N} visitor(s), ${ROUNDS} round(s), ${SIZE}x${SIZE}, ${FAKE ? "stand-ins" : MODELS.join(" + ")}, seed ${SEED}, ${PARALLEL ? "simultaneous rounds, " : ""}budget ${FAKE ? "n/a" : MAX_GBP ? "about £" + MAX_GBP.toFixed(2) : MAX_TOKENS + " tokens"}`);
  console.log("Stop any time: touch ~/village.STOP");
  let total = 0, fails = 0, turns = 0, bad = 0;

  const exhausted = new Set(); // models that told us they are over quota during this run
  async function ask(v, prompt) {
    if (FAKE) { const fj = fakeTurn(v); return { j: fj, tokens: 0, err: null, model: "stand-in", raw: JSON.stringify(fj), prompt }; }
    let model = exhausted.has(v.model) ? MODELS.find((m) => !exhausted.has(m)) : v.model;
    if (!model) return { j: null, tokens: 0, err: "every model is over its quota", model: v.model, raw: "", prompt };
    try {
      const r = await askGemini(model, prompt);
      return { j: parseReply(r.text), tokens: r.tokens, err: null, model, raw: r.text, prompt };
    } catch (e) {
      if (e.quota) {
        exhausted.add(model);
        console.log(`   (${model} is over its quota; using another model for its turns from now on)`);
        const alt = MODELS.find((m) => !exhausted.has(m));
        if (alt) {
          try { const r = await askGemini(alt, prompt); return { j: parseReply(r.text), tokens: r.tokens, err: null, model: alt, raw: r.text, prompt }; }
          catch (e2) { if (e2.quota) exhausted.add(alt); return { j: null, tokens: 0, err: clip(e2.message, 200), model: alt, raw: "", prompt }; }
        }
      }
      return { j: null, tokens: 0, err: clip(e.message, 200), model, raw: "", prompt };
    }
  }
  async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }));
    return out;
  }
  function settle(round, v, r) {
    total += r.tokens; v.tokens += r.tokens; v.turns++; turns++; RUN.tokens = total; RUN.turns = turns;
    if (r.err) { v.errors++; fails++; } else fails = 0;
    let res;
    if (r.err) res = { a: "error", ok: false, msg: r.err };
    else if (!r.j) res = { a: "unclear", ok: false, msg: "Your reply was not understood, so the turn passed." };
    else res = apply(v, r.j);
    if (res.a === "error" || res.a === "unclear") bad++;
    v.events.push(res.msg);
    v.buf.push({ round, usedModel: r.model, action: res.a, ok: res.ok, result: clip(res.msg, 300), detail: r.j ? clip(JSON.stringify(r.j), 600) : null, pos: [v.x, v.y], stage: v.stage, tokens: r.tokens });
    v.led.push({ round, visitor: v.id, model: r.model, prompt: r.prompt, reply: r.raw, action: res.a, ok: res.ok, result: res.msg, tokens: r.tokens, error: r.err || null, position: [v.x, v.y] });
    if (res.a === "say") board[board.length - 1].round = round;
    const words = r.j && res.ok ? ({ say: r.j.text, adapt: r.j.trait, propose: r.j.text, sleep: r.j.note, name: r.j.name, label: r.j.text })[res.a] : null;
    console.log(`r${round} ${v.id} (${FAKE ? "stand-in" : r.model || v.model}): ${res.a}${res.ok ? "" : " (not done)"} — ${words ? "\u201c" + clip(String(words).replace(/\s+/g, " "), 240) + "\u201d" : clip(res.msg, 90)}${r.tokens ? " [" + r.tokens + " tok]" : ""}`);
  }
  function mustStop() {
    if (fs.existsSync(STOP)) return "kill switch";
    if (!FAKE && MAX_GBP && costGBP() >= MAX_GBP) return "cost cap";
    if (!FAKE && !MAX_GBP && total >= MAX_TOKENS) return "token budget";
    if (fails >= 3) return "errors";
    return null;
  }

  outer: for (let round = 1; round <= ROUNDS; round++) {
    const order = shuffle(visitors.filter((v) => v.active));
    if (PARALLEL) {
      const why = mustStop();
      if (why) { ended = why; console.log("Stopping: " + why + "."); break; }
      const prompts = order.map((v) => (FAKE ? "" : turnPrompt(v, round)));
      const results = await pool(order, CONCURRENCY, (v, i) => ask(v, prompts[i]));
      for (let i = 0; i < order.length; i++) settle(round, order[i], results[i]);
    } else {
      for (const v of order) {
        if (!v.active) continue;
        const why = mustStop();
        if (why) { ended = why; console.log("Stopping: " + why + "."); break outer; }
        settle(round, v, await ask(v, FAKE ? "" : turnPrompt(v, round)));
      }
    }
    if (round % 10 === 0 && !FAKE) console.log(`   … round ${round}: about £${costGBP().toFixed(3)} so far`);
    if (!visitors.some((v) => v.active)) { ended = "everyone left"; break; }
  }
  flushLog(ended);
  summary();
  const costLine = FAKE ? "" : ` Estimated cost: about £${costGBP().toFixed(3)} (list prices, $1 = £${USD_GBP}; the Google billing report is the real figure).`;
  if (exhausted.size) console.log("Over quota during this run: " + [...exhausted].join(", ") + ".");
  console.log(`Done (${ended}). Turns: ${turns}. Tokens used: ${total}.${costLine}`);
  // a quick gate for the next command in a chain: fail if most replies were not understood
  process.exit(turns && bad / turns > 0.5 ? 3 : 0);
})();
