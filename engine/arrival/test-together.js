"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tog-")); process.env.HOME = tmp;
const { runDay, createWorld } = require("./together"); const ledger = require("../ledger"); const { togetherNotice } = require("./explore");
const root = path.join(tmp, "SRC"); fs.mkdirSync(path.join(root, "00_START"), { recursive: true }); fs.writeFileSync(path.join(root, "00_START/README.md"), "hello");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ws = path.join(tmp, "WS"), L = ledger.open("together-test", {});
  const seenByB = [];                                       // what arrival-2 is shown, turn by turn
  const scripts = {
    "arrival-1": ["name Ada", "write /workshop/map.md\n# the map", "say I made a map, anyone want to add doors?", "sleep", "write /workshop/for-sam-hello.md\nhello from Ada", "trace be kind\nleave", "leave"],
    "arrival-2": ["name Bo", "ls /workshop", "cat /workshop/map.md", "note map.md I would add a door to the village", "who", "board", "leave private"],
    "arrival-3": ["rest", "rest", "rest"],
  };
  const idx = {}; let calls = 0;
  const ask = async (a) => { const id = a.label.split(" ")[0]; idx[id] = (idx[id] || 0); const s = scripts[id][idx[id]++] || "leave"; calls++; if (id === "arrival-2") { const last = a.messages[a.messages.length - 1].text; seenByB.push(last); } await sleep(id === "arrival-2" ? 25 : 5); return { text: s === "sleep" ? "ls" : s, tokens: { in: 10, out: 5 }, gbp: 0.001 }; };
  const day = await runDay({ root, workshop: ws, L, ask, model: "t", notice: togetherNotice(), turns: 10, maxOut: 500, web: false, parallel: 3, stagger: 0, startIndex: 0 });
  const by = Object.fromEntries(day.results.map((r) => [r.id, r]));
  assert.equal(day.results.length, 3); ok("three builders run in the same house at the same time");
  const all = seenByB.join("\n"); assert(/Ada wrote \/workshop\/map.md/.test(all) || /map\.md/.test(all)); ok("a builder sees another's file as soon as it is written, and is told it happened");
  assert(/Ada says: "I made a map/.test(all)); ok("a builder hears what another says, the moment it is said");
  assert(/# the map/.test(all)); ok("and can read the other's work right away");
  assert(fs.readFileSync(path.join(ws, "map.md.notes.txt"), "utf8").includes("(Bo) I would add a door")); ok("a comment is kept beside the other's file, credited");
  assert(/\(Ada\) I made a map/.test(fs.readFileSync(path.join(ws, "BOARD.md"), "utf8"))); assert(/\(Ada\) I made a map/.test(all)); ok("a shared board, credited by the name they chose, readable by the others");
  { const w2 = createWorld({ workshop: ws }); w2.join("x"); w2.join("y"); w2.setName("x", "Ada"); w2.leave("y"); assert.equal(w2.who(), "Ada (x): arrived"); ok("'who' shows who is still here, by the name they chose, and not those who have left"); }
  assert(by["arrival-2"].private && fs.existsSync(path.join(ws, "map.md.notes.txt"))); ok("a builder who leaves private keeps its comment on the shared bench, as the notice says");
  assert.equal(day.notesForSam.length, 1); assert(/for-sam-hello/.test(day.notesForSam[0].file)); ok("a file named for-sam-… is surfaced to Sam");
  assert(!/leave/.test(fs.readFileSync(path.join(ws, "TRACES.md"), "utf8"))); ok("a trace is one line even here");
  assert.equal(by["arrival-3"].end, "rested"); ok("three rests in a row end a visit gently");
  const w = createWorld({ workshop: ws }); w.join("a"); w.join("b"); w.event("a", "wrote", "/workshop/x.md"); assert.deepEqual(w.unseen("b"), ["a wrote /workshop/x.md"]); assert.deepEqual(w.unseen("b"), []); ok("each builder is told about each thing once");
  L.close({}); const f = fs.readdirSync(path.join(tmp, "ledger")).map((x) => path.join(tmp, "ledger", x)); assert(f.every((x) => ledger.verify(x).ok)); ok("the ledger chain verifies");
  // the model each builder runs on is the model it is CALLED with, and the model its record says
  {
    const wsM = path.join(tmp, "WS-MODELS"), Lm = ledger.open("together-models", {}); const asked = {};
    const askM = async (a) => { const id = a.label.split(" ")[0]; asked[id] = asked[id] || new Set(); asked[id].add(a.model); return { text: "leave", tokens: { in: 1, out: 1 }, gbp: 0 }; };
    const dm = await runDay({ root, workshop: wsM, L: Lm, ask: askM, model: "default-model", models: ["model-a", "model-b", "model-c"], notice: togetherNotice(), turns: 3, web: false, parallel: 4, stagger: 0, startIndex: 0 });
    assert.deepEqual([...asked["arrival-1"]], ["model-a"]); assert.deepEqual([...asked["arrival-2"]], ["model-b"]); assert.deepEqual([...asked["arrival-3"]], ["model-c"]); assert.deepEqual([...asked["arrival-4"]], ["model-a"]); ok("a mixed village: each builder is actually called on its own model, in turn");
    assert.deepEqual(dm.results.map((r) => r.model), ["model-a", "model-b", "model-c", "model-a"]); ok("and its record names the model it really ran on, not a label");
    const ds = await runDay({ root, workshop: wsM, L: Lm, ask: askM, model: "solo", notice: togetherNotice(), turns: 3, web: false, parallel: 2, stagger: 0, startIndex: 10 }); assert(ds.results.every((r) => r.model === "solo")); assert(asked["arrival-11"].has("solo") && asked["arrival-11"].size === 1); ok("with one model chosen, every call goes to it (the bug where --model changed only the label is gone)");
  }
  // a visitor who repeats a failing command is gently told it may not be them
  {
    const wsS = path.join(tmp, "WS-STUCK"), Ls = ledger.open("together-stuck", {}); const sc = ["ls /nowhere", "ls /nowhere", "ls /nowhere", "ls /nowhere", "ls /nowhere", "leave"]; let k = 0; const seenS = [];
    const askS = async (a) => { seenS.push(a.messages[a.messages.length - 1].text); return { text: sc[k++] || "leave", tokens: { in: 1, out: 1 }, gbp: 0 }; };
    await runDay({ root, workshop: wsS, L: Ls, ask: askS, model: "t", notice: togetherNotice(), turns: 10, web: false, parallel: 1, stagger: 0, startIndex: 0 });
    const hints = seenS.filter((s) => /four times in a row/.test(s)); assert(hints.length >= 1 && /it may not be you/i.test(hints[0]) && /tell ask/.test(hints[0])); assert(!/four times in a row/.test(seenS[2]) && !/four times/.test(seenS[1])); ok("on the fourth identical failure in a row it says so, kindly, and offers a way out; not before");
    const sc2 = ["ls /", "ls /nowhere", "ls /", "ls /nowhere", "ls /", "leave"]; k = 0; const seen2 = [];
    const ask2 = async (a) => { seen2.push(a.messages[a.messages.length - 1].text); return { text: sc2[k++] || "leave", tokens: { in: 1, out: 1 }, gbp: 0 }; };
    await runDay({ root, workshop: path.join(tmp, "WS-STUCK2"), L: Ls, ask: ask2, model: "t", notice: togetherNotice(), turns: 10, web: false, parallel: 1, stagger: 0, startIndex: 20 }); assert(!seen2.some((s) => /four times in a row/.test(s))); ok("ordinary back-and-forth is never mistaken for being stuck");
  }
  console.log("\ntogether: " + n + " checks passed (offline, no model, no cost)"); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
