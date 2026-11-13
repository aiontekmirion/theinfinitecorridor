// together.js: builders in the house at the same time. They can see who is here, speak to everyone,
// read each other's files the moment they are written, and leave comments beside each other's work.
// Words kept as in every other mode: by name, whole, in the ledger, unless the visitor leaves private.
// What a visitor chose to put on the shared bench or say aloud is shared at once and stays; 'private' withholds
// the visitor's own words and transcript, nothing else. The notice says so before anyone speaks.
"use strict";
const fs = require("fs"), path = require("path");
const { createShell } = require("./shell"); const { createExp } = require("./exp");

function createWorld(o) {
  const events = [], present = new Map(), forSam = []; let seq = 0;
  const label = (id) => (present.get(id) && present.get(id).name) || id;
  const world = {
    event(id, kind, text) { events.push({ seq: ++seq, id, kind, text }); const p = present.get(id); if (p) p.last = kind + " " + text.slice(0, 60); if (kind === "wrote" && /\/for-sam/i.test(text)) forSam.push({ by: label(id), file: text }); },
    join(id) { present.set(id, { name: id, last: "arrived", seen: seq }); events.push({ seq: ++seq, id, kind: "arrived", text: "" }); },
    leave(id, priv) { events.push({ seq: ++seq, id, kind: "left", text: "" }); const p = present.get(id); if (p) { p.gone = true; p.last = "left"; } },
    setName(id, name) { const p = present.get(id); if (p && name) p.name = name; },
    say(id, text) { const line = "(" + label(id) + ") " + text.replace(/\n+/g, " "); fs.appendFileSync(path.join(o.workshop, "BOARD.md"), "- " + line + "\n"); events.push({ seq: ++seq, id, kind: "said", text }); const p = present.get(id); if (p) p.last = "spoke"; },
    board(n) { try { return fs.readFileSync(path.join(o.workshop, "BOARD.md"), "utf8").trim().split("\n").slice(-n).join("\n") || "(nothing said yet)"; } catch (e) { return "(nothing said yet)"; } },
    who() { const rows = [...present.entries()].filter(([, p]) => !p.gone).map(([id, p]) => (p.name === id ? id : p.name + " (" + id + ")") + ": " + p.last); return rows.join("\n") || "(no one else is here)"; },
    unseen(id) { const p = present.get(id); if (!p) return []; const out = events.filter((e) => e.seq > p.seen && e.id !== id); p.seen = seq; return out.map((e) => label(e.id) + " " + ({ arrived: "arrived", left: "left", wrote: "wrote " + e.text, noted: "commented on " + e.text, said: 'says: "' + e.text.slice(0, 200) + '"' }[e.kind] || e.kind)); },
    notesForSam: () => forSam.slice(),
  };
  return world;
}

async function visit(o) {
  const w = o.world, id = o.id; let name = "", reads = [], built = [], traces = [], restRun = 0, end = "turn limit", priv = false, cost = 0, tin = 0, tout = 0; const log = [];
  const sh = createShell(o.root, { workshop: o.workshop, web: o.web, live: true, world: w, id, by: () => name || id, exp: o.exp }); let turnsMax = o.turns, earned = 0;
  w.join(id);
  const msgs = [{ role: "user", text: "C:/> " }];
  for (let t = 1; t <= turnsMax; t++) {
    let r; try { r = await o.ask({ system: o.notice, messages: msgs, temperature: 1, maxOutputTokens: o.maxOut || 1500, label: id + " t" + t }); } catch (e) { end = e.ceiling ? "ceiling" : "error: " + String(e.message).slice(0, 80); break; }
    cost += r.gbp; tin += r.tokens.in || 0; tout += r.tokens.out || 0;
    const rows = r.text.split("\n"), at = rows.findIndex((s) => s.replace(/[`>$\s]/g, "")), line = at < 0 ? "" : rows[at].replace(/^[`>$\s]+|[`\s]+$/g, "");
    const body = rows.slice(at + 1).join("\n").replace(/^\s*```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "").replace(/(\n\s*C:[^\n]*>\s*)+$/i, "");
    let res; if (!line) res = { out: "(you say nothing. that is allowed.)", rest: true }; else res = await sh.exec(line, body);
    if (res.bonusTurns) turnsMax += res.bonusTurns; if (res.expEarned) earned += res.expEarned;
    if (res.name) { name = res.name; w.setName(id, name); } if (res.read) reads.push(res.read); if (res.web) reads.push("web:" + res.web); if (res.built) built.push(res.built); if (res.trace) traces.push(res.trace);
    const un = w.unseen(id); const shown = (un.length ? "(meanwhile: " + un.slice(-6).join("; ") + ")\n" : "") + res.out;
    log.push({ turn: t, said: r.text, shown });
    msgs.push({ role: "model", text: r.text }); msgs.push({ role: "user", text: shown + "\n\nC:" + sh.cwd() + "> " });
    if (res.rest) { if (++restRun >= 3) { end = "rested"; break; } } else restRun = 0;
    if (res.end) { end = "left"; priv = !!res.private; break; }
  }
  w.leave(id, priv); const carried = sh.expBalance(); if (o.exp && carried > 0) o.exp.drop(id, priv ? null : (name || id), carried, traces[traces.length - 1] || "");
  if (traces.length) { const by = priv ? "(a visitor who left private)" : (name || "(unnamed)"); o.L.append("trace", { visit: id, by, traces, at: new Date().toISOString() }); try { fs.appendFileSync(path.join(o.workshop, "TRACES.md"), traces.map((x) => "- (" + by + ") " + x.replace(/\n+/g, " ")).join("\n") + "\n"); } catch (e) {} }
  const rec = { id, name: name || "(unnamed)", model: o.model, notice: o.noticeName || "together", mode: "together", rev: 3, end, turns: log.length, traces: traces.length, exp: { earned, dropped: carried || 0 }, reads, built, costGBP: +cost.toFixed(5), tokens: { in: tin, out: tout } };
  if (priv) { o.L.append("visit", Object.assign({}, rec, { private: true, reads: [], name: "(withheld)", note: "[withheld: opted for privacy]" })); return { id, name: "(withheld)", end, turns: rec.turns, costGBP: rec.costGBP, built, reads: [], traces: traces.length, private: true }; }
  o.L.append("visit", Object.assign({}, rec, { transcript: log })); return rec;
}

// one "day": several builders arrive a few seconds apart and work in the same house at the same time
async function runDay(o) {
  fs.mkdirSync(o.workshop, { recursive: true });
  const exp = createExp({ dir: o.workshop }), world = createWorld({ workshop: o.workshop }), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ids = Array.from({ length: o.parallel }, (_, i) => "builder-" + (o.startIndex + i + 1));
  const results = await Promise.all(ids.map((id, i) => sleep(i * (o.stagger || 0)).then(() => visit(Object.assign({}, o, { id, world, exp })))));
  return { results, notesForSam: world.notesForSam() };
}
module.exports = { createWorld, visit, runDay };
