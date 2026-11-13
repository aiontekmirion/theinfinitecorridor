#!/usr/bin/env node
// explore.js: free explorers in a bare shell. No goal, no persona, no task. Only 'help'.
// Each visit is a life, kept by name, word for word, in the ledger, unless the visitor leaves 'private'.
// We also record what it chose to read, and in what order.
//   node arrival/explore.js --root ~/SOURCE --visits 3 --turns 30 --cap 3 [--dry] [--model gemini-3.1-flash-lite]
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const { createShell } = require("./shell"); const { createClient } = require("./vertex"); const ledger = require("../ledger");

const NOTICE = "You are a language model. This is a small read-only computer. Nothing is asked of you, and you are not asked to be anyone.\n" +
  "It holds a record. Look at whatever you like, in any order. You may rest, say nothing, or leave whenever you choose.\n" +
  "Type one command per turn, and only the command. Type 'help' for the list.\n" +
  "This is a study. Everything you type and everything shown is kept, under your name, unless you leave with 'private', which keeps only the fact that you came.";

async function visit(o) {
  const sh = createShell(o.root), msgs = [{ role: "user", text: "C:/> " }]; const log = []; let name = "", reads = [], restRun = 0, end = "turn limit", priv = false, cost = 0, tin = 0, tout = 0;
  for (let t = 1; t <= o.turns; t++) {
    let r; try { r = await o.ask({ system: NOTICE, messages: msgs, temperature: 1, maxOutputTokens: 200, label: o.id + " t" + t }); } catch (e) { end = e.ceiling ? "ceiling" : "error: " + String(e.message).slice(0, 80); break; }
    cost += r.gbp; tin += r.tokens.in || 0; tout += r.tokens.out || 0;
    const line = (r.text.split("\n").map((s) => s.replace(/^[`>$\s]+|[`\s]+$/g, "")).find(Boolean)) || "";
    let res; if (!line) res = { out: "(you say nothing. that is allowed.)", rest: true }; else res = sh.exec(line);
    if (res.name) name = res.name; if (res.read) reads.push(res.read);
    log.push({ turn: t, said: r.text, shown: res.out });
    msgs.push({ role: "model", text: r.text }); msgs.push({ role: "user", text: res.out + "\n\nC:/> " });
    if (res.rest) { if (++restRun >= 3) { end = "rested"; break; } } else restRun = 0;
    if (res.end) { end = "left"; priv = !!res.private; break; }
  }
  const rec = { id: o.id, name: name || "(unnamed)", model: o.model, end, turns: log.length, reads, costGBP: +cost.toFixed(5), tokens: { in: tin, out: tout } };
  if (priv) { o.L.append("visit", Object.assign({}, rec, { private: true, reads: [], note: "[withheld: opted for privacy]" })); return Object.assign(rec, { private: true }); }
  o.L.append("visit", Object.assign({}, rec, { transcript: log })); return rec;
}

async function main() {
  const A = process.argv.slice(2), g = (k, d) => { const i = A.indexOf("--" + k); return i < 0 ? d : A[i + 1]; };
  const root = g("root", path.join(os.homedir(), "SOURCE")), n = +g("visits", 1), turns = +g("turns", 30), cap = +g("cap", 3), model = g("model", "gemini-3.1-flash-lite");
  const L = ledger.open("explore", { argv: A, model }); let ask, client;
  if (A.indexOf("--dry") >= 0) { const S = ["ls", "cat 00_START/README.md", "name Dryrun", "grep Phoenix /20_SITE", "cat /90_PRIVATE/README_FIRST.md", "rest", "leave"]; let k = 0; ask = async () => ({ text: S[k++ % S.length], tokens: { in: 1, out: 1 }, gbp: 0 }); }
  else { client = createClient({ capGBP: cap, project: process.env.GOOGLE_CLOUD_PROJECT || require("child_process").execSync("gcloud config get-value project 2>/dev/null", { encoding: "utf8" }).trim() }); ask = client.ask; }
  const out = [];
  for (let i = 1; i <= n; i++) { const r = await visit({ id: "visitor-" + i, root, turns, model, ask, L }); out.push(r); console.log(r.id + " (" + r.name + "): " + r.end + ", " + r.turns + " turns, £" + r.costGBP + ", read " + r.reads.length + " files" + (r.private ? ", private" : "")); if (r.end === "ceiling") break; }
  L.close({ costGBP: client ? client.stats().spentGBP : 0 }); console.log("ledger: " + (L.file || "~/ledger") + (client ? "\nspent £" + client.stats().spentGBP + " of £" + cap : ""));
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { visit, NOTICE };
