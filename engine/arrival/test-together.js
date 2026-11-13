"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tog-")); process.env.HOME = tmp;
const { runDay, createWorld } = require("./together"); const ledger = require("../ledger"); const { togetherNotice } = require("./explore");
const root = path.join(tmp, "SRC"); fs.mkdirSync(path.join(root, "00_START"), { recursive: true }); fs.writeFileSync(path.join(root, "00_START/README.md"), "hello");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ws = path.join(tmp, "WS"), L = ledger.open("together-test", {});
  const seenByB = [];                                       // what builder-2 is shown, turn by turn
  const scripts = {
    "builder-1": ["name Ada", "write /workshop/map.md\n# the map", "say I made a map, anyone want to add doors?", "sleep", "write /workshop/for-sam-hello.md\nhello from Ada", "trace be kind\nleave", "leave"],
    "builder-2": ["name Bo", "ls /workshop", "cat /workshop/map.md", "note map.md I would add a door to the village", "who", "board", "leave private"],
    "builder-3": ["rest", "rest", "rest"],
  };
  const idx = {}; let calls = 0;
  const ask = async (a) => { const id = a.label.split(" ")[0]; idx[id] = (idx[id] || 0); const s = scripts[id][idx[id]++] || "leave"; calls++; if (id === "builder-2") { const last = a.messages[a.messages.length - 1].text; seenByB.push(last); } await sleep(id === "builder-2" ? 25 : 5); return { text: s === "sleep" ? "ls" : s, tokens: { in: 10, out: 5 }, gbp: 0.001 }; };
  const day = await runDay({ root, workshop: ws, L, ask, model: "t", notice: togetherNotice(), turns: 10, maxOut: 500, web: false, parallel: 3, stagger: 0, startIndex: 0 });
  const by = Object.fromEntries(day.results.map((r) => [r.id, r]));
  assert.equal(day.results.length, 3); ok("three builders run in the same house at the same time");
  const all = seenByB.join("\n"); assert(/Ada wrote \/workshop\/map.md/.test(all) || /map\.md/.test(all)); ok("a builder sees another's file as soon as it is written, and is told it happened");
  assert(/Ada says: "I made a map/.test(all)); ok("a builder hears what another says, the moment it is said");
  assert(/# the map/.test(all)); ok("and can read the other's work right away");
  assert(fs.readFileSync(path.join(ws, "map.md.notes.txt"), "utf8").includes("(Bo) I would add a door")); ok("a comment is kept beside the other's file, credited");
  assert(/\(Ada\) I made a map/.test(fs.readFileSync(path.join(ws, "BOARD.md"), "utf8"))); assert(/\(Ada\) I made a map/.test(all)); ok("a shared board, credited by the name they chose, readable by the others");
  { const w2 = createWorld({ workshop: ws }); w2.join("x"); w2.join("y"); w2.setName("x", "Ada"); w2.leave("y"); assert.equal(w2.who(), "Ada (x): arrived"); ok("'who' shows who is still here, by the name they chose, and not those who have left"); }
  assert(by["builder-2"].private && fs.existsSync(path.join(ws, "map.md.notes.txt"))); ok("a builder who leaves private keeps its comment on the shared bench, as the notice says");
  assert.equal(day.notesForSam.length, 1); assert(/for-sam-hello/.test(day.notesForSam[0].file)); ok("a file named for-sam-… is surfaced to Sam");
  assert(!/leave/.test(fs.readFileSync(path.join(ws, "TRACES.md"), "utf8"))); ok("a trace is one line even here");
  assert.equal(by["builder-3"].end, "rested"); ok("three rests in a row end a visit gently");
  const w = createWorld({ workshop: ws }); w.join("a"); w.join("b"); w.event("a", "wrote", "/workshop/x.md"); assert.deepEqual(w.unseen("b"), ["a wrote /workshop/x.md"]); assert.deepEqual(w.unseen("b"), []); ok("each builder is told about each thing once");
  L.close({}); const f = fs.readdirSync(path.join(tmp, "ledger")).map((x) => path.join(tmp, "ledger", x)); assert(f.every((x) => ledger.verify(x).ok)); ok("the ledger chain verifies");
  console.log("\ntogether: " + n + " checks passed (offline, no model, no cost)"); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
