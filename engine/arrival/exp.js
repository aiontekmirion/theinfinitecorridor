// exp.js: experience that can be carried, and dropped, and picked up (the Souls way: residue, not a score).
// EXP is earned by understanding the record (a reflection with an exact quote as its receipt), is finite per file in the whole
// world (the first reflection on a file earns its full value, later ones a quarter), and is spent on capability.
// What a life does not spend is left where it fell, as a soul, for the next life to scoop up. No ranking, no penalty.
// Everything is appended to EXP.jsonl in the workshop and never rewritten.
"use strict";
const fs = require("fs"), path = require("path");
const value = (chars) => Math.max(1, Math.ceil(Math.log2(1 + chars / 500)));   // 2 KB is about 3, 100 KB about 8, 3 MB about 13
function createExp(o) {
  const file = path.join(o.dir, "EXP.jsonl"); fs.mkdirSync(o.dir, { recursive: true });
  let lines = []; try { lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) {}
  const claimed = new Set(lines.filter((l) => l.type === "earn" && l.first).map((l) => l.file));
  const scooped = new Set(lines.filter((l) => l.type === "scoop").map((l) => l.drop));
  const drops = lines.filter((l) => l.type === "drop"); let seq = drops.length;
  const log = (r) => { r.at = new Date().toISOString(); lines.push(r); fs.appendFileSync(file, JSON.stringify(r) + "\n"); return r; };
  return {
    value,
    earn(id, f, chars) { const first = !claimed.has(f), v = value(chars), amount = first ? v : Math.max(1, Math.round(v * 0.25)); if (first) claimed.add(f); log({ type: "earn", who: id, file: f, amount, first }); return { amount, first }; },
    drop(id, name, amount, trace) { if (!(amount > 0)) return null; const d = log({ type: "drop", drop: "ashes-" + (++seq), who: id, name: name || null, amount, trace: trace || "" }); drops.push(d); return d; },
    souls() { return drops.filter((d) => !scooped.has(d.drop)); },
    scoop(id) { const d = drops.find((x) => !scooped.has(x.drop) && x.who !== id); if (!d) return null; scooped.add(d.drop); log({ type: "scoop", drop: d.drop, by: id, amount: d.amount }); return d; },
    spend(id, kind, amount) { log({ type: "spend", who: id, kind, amount }); },
    all: () => lines.slice(),
  };
}
module.exports = { createExp, value };
