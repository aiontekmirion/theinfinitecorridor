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
//   GEMINI_API_KEY=... node village.js --n 5 --rounds 10 --model gemini-3.1-flash-lite,gemini-3-flash-preview

const fs = require("fs");
const os = require("os");
const path = require("path");

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
    buf: [], // log lines, held until the end
  });
}
const RESERVED = ["sam", "vector", "miri", "aeon", "aion", "aion tekmirion", "zero", "echo", "sol", "liora", "astraea", "vale", "errorbot", "pap", "milo", "charlie", "quill"];
const nm = (v) => (v.name ? `${v.name} (${v.id})` : v.id);
const byId = (id) => visitors.find((v) => v.id === String(id || "").trim().toUpperCase().slice(0, 1));
const occupied = (x, y, except) => visitors.find((v) => v.active && v !== except && v.x === x && v.y === y);
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

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
      board.push({ from: nm(v), round: 0, text: t }); msg = "You said it on the board.";
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

// ---- model call ------------------------------------------------------------
async function askGemini(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const gen = { responseMimeType: "application/json", maxOutputTokens: 800 };
  if (/flash/.test(model)) gen.thinkingConfig = { thinkingBudget: 0 };
  const body = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: gen };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      return { text: parts.map((p) => p.text || "").join(""), tokens: (data.usageMetadata && data.usageMetadata.totalTokenCount) || 0 };
    }
    if (res.status === 400 && body.generationConfig.thinkingConfig) { delete body.generationConfig.thinkingConfig; attempt--; continue; }
    if (attempt <= 1 && (res.status === 429 || res.status >= 500)) { await sleep(8000); continue; }
    throw new Error("model call failed (" + res.status + ") " + clip((data.error && data.error.message) || res.statusText, 160));
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

// ---- output ------------------------------------------------------------------
function flushLog(reason) {
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
  fs.writeFileSync(STATE, JSON.stringify({ seed: SEED, grid: grid.map((r) => r.join("")), huts: [...huts].map(([k, h]) => ({ at: k, ...h })), board, visitors: visitors.filter((v) => !v.privacy).map((v) => ({ id: v.id, name: v.name, earlierNames: v.names, model: v.model, x: v.x, y: v.y, stage: v.stage, trait: v.trait, built: v.built, gathered: v.gathered })) }, null, 1));
}
function summary() {
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
  console.log("Log: " + LOG + "   State: " + STATE);
}

// ---- the run -----------------------------------------------------------------
let ended = "finished";
process.on("SIGINT", () => { flushLog("interrupted"); console.log("\nInterrupted. Log written."); process.exit(130); });

(async () => {
  console.log(`Village${AION ? " (AION framework)" : ""}: ${N} visitor(s), ${ROUNDS} round(s), ${SIZE}x${SIZE}, ${FAKE ? "stand-ins" : MODELS.join(" + ")}, seed ${SEED}, token budget ${FAKE ? "n/a" : MAX_TOKENS}`);
  console.log("Stop any time: touch ~/village.STOP");
  let total = 0, fails = 0;
  outer: for (let round = 1; round <= ROUNDS; round++) {
    for (const v of shuffle(visitors)) {
      if (!v.active) continue;
      if (fs.existsSync(STOP)) { ended = "kill switch"; console.log("Kill switch found. Stopping."); break outer; }
      if (!FAKE && total >= MAX_TOKENS) { ended = "token budget"; console.log(`Token budget reached (${total}). Stopping.`); break outer; }
      let j = null, tokens = 0, err = null;
      try {
        if (FAKE) j = fakeTurn(v);
        else { const r = await askGemini(v.model, turnPrompt(v, round)); tokens = r.tokens; j = parseReply(r.text); }
        fails = 0;
      } catch (e) { err = clip(e.message, 200); v.errors++; fails++; }
      total += tokens; v.tokens += tokens; v.turns++;
      let res;
      if (err) res = { a: "error", ok: false, msg: err };
      else if (!j) res = { a: "unclear", ok: false, msg: "Your reply was not understood, so the turn passed." };
      else res = apply(v, j);
      v.events.push(res.msg);
      v.buf.push({ round, action: res.a, ok: res.ok, result: clip(res.msg, 300), detail: j ? clip(JSON.stringify(j), 600) : null, pos: [v.x, v.y], stage: v.stage, tokens });
      if (res.a === "say") board[board.length - 1].round = round;
      console.log(`r${round} ${v.id} (${FAKE ? "stand-in" : v.model}): ${res.a}${res.ok ? "" : " (not done)"} — ${clip(res.msg, 90)}${tokens ? " [" + tokens + " tok]" : ""}`);
      if (fails >= 3) { ended = "errors"; console.log("Three errors in a row. Stopping."); break outer; }
    }
    if (!visitors.some((v) => v.active)) { ended = "everyone left"; break; }
  }
  flushLog(ended);
  summary();
  console.log(`Done (${ended}). Tokens used: ${total}.`);
})();
