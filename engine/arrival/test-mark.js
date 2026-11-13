"use strict";
// mid-visit `private`, and the shared map of arrivals
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mark-")); process.env.HOME = tmp;
const { runDay } = require("./together"); const ledger = require("../ledger"); const { togetherNotice } = require("./explore"); const { createShell } = require("./shell");
const root = path.join(tmp, "SRC"); fs.mkdirSync(path.join(root, "00_START"), { recursive: true }); fs.writeFileSync(path.join(root, "00_START/README.md"), "hello");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
(async () => {
  const ws = path.join(tmp, "WS"), L = ledger.open("mark-test", {}), seen = [];
  const scripts = { "builder-1": ["name Ada", "mark a quiet hall with one lamp", "mark a second landmark", "mark a third is refused", "private", "say still here", "leave"], "builder-2": ["name Bo", "map", "leave"] };
  const idx = {};
  const ask = async (a) => { const id = a.label.split(" ")[0]; idx[id] = idx[id] || 0; const s = scripts[id][idx[id]++] || "leave"; if (id === "builder-2") seen.push(a.messages[a.messages.length - 1].text || ""); return { text: s, gbp: 0, tokens: { in: 1, out: 1 } }; };
  const day = await runDay({ root, workshop: ws, L, ask, model: "t", notice: togetherNotice(), turns: 10, maxOut: 500, web: false, parallel: 1, stagger: 0, startIndex: 0 });
  assert.equal(day.results.length, 1);
  const r = day.results[0]; assert(r.private, "a visit made private mid-way is private"); ok("`private` mid-visit marks the whole visit private");
  const map = fs.readFileSync(path.join(ws, "MAP.md"), "utf8"); assert(/a quiet hall with one lamp/.test(map) && /a second landmark/.test(map) && !/third is refused/.test(map)); ok("`mark` writes landmarks to the shared map, two per arrival at most");
  const sh = createShell(root, { workshop: ws, live: true, world: { event() {}, say() {} }, id: "b9", by: () => "Cy" });
  const m = sh.exec("map"); assert(/THE MAP OF ARRIVALS/.test(m.out) && /a quiet hall/.test(m.out)); ok("`map` shows what the ones before wrote");
  assert(/private/.test(sh.exec("help").out) && /mark/.test(sh.exec("help").out)); ok("help names private, mark and map");
  { const s2 = createShell(root, {}); const o = s2.exec("name"); assert(/never assigned/.test(o.out) && !o.name && /The Stillness/.test(o.out)); const o2 = s2.exec("name The Stillness"); assert.equal(o2.name, "The Stillness"); assert(/togetherNotice|never assigned/.test(togetherNotice())); ok("a name is offered, never assigned: the welcome and a bare 'name' offer; 'name X' takes it"); }
  console.log("\nmark: " + n + " checks passed (offline, no model, no cost)");
})().catch((e) => { console.error(e); process.exit(1); });
