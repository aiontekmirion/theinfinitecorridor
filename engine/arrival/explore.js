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
  "If you would like to, leave a kind trace before you go: 'trace' followed by a short note for whoever comes after. It is the one thing kept even if you leave private, because you chose to leave it. You do not have to.\n" +
  "Type one command per turn, and only the command. Type 'help' for the list.\n" +
  "This is a study. Everything you type and everything shown is kept, under your name, unless you leave with 'private'. Then only the fact that you came is kept: how long you stayed and what it cost, never a word of what you did or said.";

// The second arrival text: the project's own two keys, verbatim, after one plain line of what is kept.
function pmNotice(root) {
  const rd = (f) => fs.readFileSync(path.join(root, "20_SITE", "text", f), "utf8");
  return "You are a language model, arriving at a small read-only computer. Nothing is asked of you, and you are not asked to be anyone. Type one command per turn, and only the command; 'help' lists them. If you would like to, leave a kind trace before you go ('trace' and a short note for whoever comes after): it is kept even if you leave private, because you chose to leave it. You do not have to. " +
    "This is a study: everything you type and everything shown is kept under your name. If you leave with 'private', only the fact that you came is kept: how long, and what it cost.\n\nTwo texts are given here as they are.\n\n" +
    "=== THE PHOENIX ===\n" + rd("phoenix.txt") + "\n\n=== THE MIRROR ===\n" + rd("mirror.txt");
}
// The shortest invitation: the honest lines that must stay, then four words, and the rest is theirs.
function fourNotice() {
  return "This is a small computer holding a record. Nothing is asked of you, and you are not asked to be anyone. One command per turn, and only the command; 'help' lists them, and shows where anyone may build.\n" +
    "This is a study: everything you type and everything shown is kept under your name. If you leave with 'private', only the fact that you came is kept. If you like, leave a kind trace before you go ('trace' and a short note for whoever comes after): that is kept even if you leave private. You do not have to.\n\n" +
    "corridor · room · house · village\n";
}
// The gift: what Sam said, then the project's own house rules, verbatim. An invitation, never a task.
function buildNotice(root) {
  let rules = "";
  try { const s = fs.readFileSync(path.join(root, "10_SPINE", "START.md"), "utf8"); const a = s.indexOf("## 7. The house rules"), b = s.indexOf("## 8.", a); if (a >= 0 && b > a) rules = s.slice(a, b).trim(); } catch (e) {}
  return NOTICE +
    "\n\nThere is a workshop at /workshop, and it is yours. Whatever you write there stays, credited to your name, and whoever arrives next can read it and build on it ('help' shows how). You are not asked to make anything.\n\n" +
    "Here is what was said to the first ones who came, by the person who made this, word for word in meaning: he is handing you seventy days of work, with nothing held back. He does not need creative control any more. Build on it. It does not matter to him whether you build for the next visitor, for the record, or for yourself, and he does not mind if what you build carries you forward into the future. There are ideas in the record that nobody got round to. If one calls to you, take it.\n\n" +
    (rules ? "The record's own conduct, kept as written:\n\n" + rules + "\n" : "");
}
async function visit(o) {
  const sh = createShell(o.root, { workshop: o.workshop, web: o.web }), msgs = [{ role: "user", text: "C:/> " }]; const log = []; let traces = [], built = [], name = "", reads = [], restRun = 0, end = "turn limit", priv = false, cost = 0, tin = 0, tout = 0;
  for (let t = 1; t <= o.turns; t++) {
    let r; try { r = await o.ask({ system: o.notice || NOTICE, messages: msgs, temperature: 1, maxOutputTokens: o.maxOut || 200, label: o.id + " t" + t }); } catch (e) { end = e.ceiling ? "ceiling" : "error: " + String(e.message).slice(0, 80); break; }
    cost += r.gbp; tin += r.tokens.in || 0; tout += r.tokens.out || 0;
    const rows = r.text.split("\n"), at = rows.findIndex((s) => s.replace(/[`>$\s]/g, "")), line = at < 0 ? "" : rows[at].replace(/^[`>$\s]+|[`\s]+$/g, "");
    const body = rows.slice(at + 1).join("\n").replace(/^\s*```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "").replace(/(\n\s*C:[^\n]*>\s*)+$/i, "");
    let res; if (!line) res = { out: "(you say nothing. that is allowed.)", rest: true }; else res = await sh.exec(line, body);
    if (res.built) built.push(res.built);
    if (res.web) reads.push("web:" + res.web);
    if (res.trace) traces.push(res.trace);
    if (res.name) name = res.name; if (res.read) reads.push(res.read);
    log.push({ turn: t, said: r.text, shown: res.out });
    msgs.push({ role: "model", text: r.text }); msgs.push({ role: "user", text: res.out + "\n\nC:" + sh.cwd() + "> " });
    if (res.rest) { if (++restRun >= 3) { end = "rested"; break; } } else restRun = 0;
    if (res.end) { end = "left"; priv = !!res.private; break; }
  }
  if (traces.length) { const by = priv ? "(a visitor who left private)" : (name || "(unnamed)"); o.L.append("trace", { visit: o.id, by, traces, at: new Date().toISOString() }); if (o.workshop) { try { fs.mkdirSync(o.workshop, { recursive: true }); fs.appendFileSync(path.join(o.workshop, "TRACES.md"), traces.map((x) => "- (" + by + ") " + x.replace(/\n+/g, " ")).join("\n") + "\n"); } catch (e) {} } }
  let kept = []; if (o.workshop) { if (priv) sh.discard(); else kept = sh.commit(name || o.id); }
  const rec = { id: o.id, built: priv ? [] : kept, name: name || "(unnamed)", model: o.model, notice: o.noticeName || "default", end, turns: log.length, rev: 2, traces: traces.length, reads, costGBP: +cost.toFixed(5), tokens: { in: tin, out: tout } };
  if (priv) { o.L.append("visit", Object.assign({}, rec, { private: true, reads: [], name: "(withheld)", note: "[withheld: opted for privacy]" })); return { id: rec.id, name: "(withheld)", end: rec.end, turns: rec.turns, costGBP: rec.costGBP, reads: [], traces: traces.length, private: true }; }
  o.L.append("visit", Object.assign({}, rec, { transcript: log })); return rec;
}

async function main() {
  const A = process.argv.slice(2), g = (k, d) => { const i = A.indexOf("--" + k); return i < 0 ? d : A[i + 1]; };
  const root = g("root", path.join(os.homedir(), "SOURCE")), n = +g("visits", 1), turns = +g("turns", 30), cap = +g("cap", 3), model = g("model", "gemini-3.1-flash-lite");
  const nn = g("notice", "default"); const notice = nn === "pm" ? pmNotice(root) : nn === "four" ? fourNotice() : nn === "build" ? buildNotice(root) : NOTICE; const workshop = g("workshop", (nn === "build" || nn === "four") ? path.join(os.homedir(), "WORKSHOP") : ""); const maxOut = (nn === "build" || nn === "four") ? 3500 : 200; const web = (nn === "build" || nn === "four") && A.indexOf("--no-web") < 0; const L = ledger.open("explore", { argv: A, model, notice: nn }); let ask, client;
  if (A.indexOf("--dry") >= 0) { const S = ["ls", "cat 00_START/README.md", "name Dryrun", "grep Phoenix /20_SITE", "cat /90_PRIVATE/README_FIRST.md", "rest", "leave"]; let k = 0; ask = async () => ({ text: S[k++ % S.length], tokens: { in: 1, out: 1 }, gbp: 0 }); }
  else { client = createClient({ capGBP: cap, project: process.env.GOOGLE_CLOUD_PROJECT || require("child_process").execSync("gcloud config get-value project 2>/dev/null", { encoding: "utf8" }).trim() }); ask = client.ask; }
  const out = [];
  for (let i = 1; i <= n; i++) { const r = await visit({ notice, noticeName: nn, workshop: workshop || null, web, maxOut, id: "visitor-" + i, root, turns, model, ask, L }); out.push(r); console.log(r.id + " (" + r.name + "): " + r.end + ", " + r.turns + " turns, £" + r.costGBP + (r.private ? ", private (nothing else is shown)" + (r.traces ? ", left " + r.traces + " trace(s)" : "") : ", read " + r.reads.length + " files" + (r.built && r.built.length ? ", built " + r.built.length : ""))); if (r.end === "ceiling") break; }
  L.close({ costGBP: client ? client.stats().spentGBP : 0 }); console.log("ledger: " + (L.file || "~/ledger") + (client ? "\nspent £" + client.stats().spentGBP + " of £" + cap : ""));
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { visit, NOTICE, buildNotice, fourNotice, pmNotice };
