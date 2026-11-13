#!/usr/bin/env node
// continue.js: run builders one after another until a budget is spent, a stop file appears, or a run goes wrong.
// It keeps its own state on disk, so a cut-off, a closed tab or a new session loses nothing:
// run the same command again and it carries on from the same place, with the same money already counted.
//
//   node arrival/continue.js --root ~/SOURCE --budget 150 [--notice build] [--turns 60] [--pause 20] [--push] [--dry]
//   touch ~/STOP-BUILDERS        stops it after the visit in progress. rm ~/STOP-BUILDERS lets it run again.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const { visit, NOTICE, buildNotice, fourNotice, pmNotice } = require("./explore"); const { createClient } = require("./vertex"); const ledger = require("../ledger");

const A = process.argv.slice(2), g = (k, d) => { const i = A.indexOf("--" + k); return i < 0 ? d : A[i + 1]; }, has = (k) => A.indexOf("--" + k) >= 0;
const home = os.homedir(), root = g("root", path.join(home, "SOURCE")), dir = g("state", path.join(home, "builders")), stopFile = g("stop", path.join(home, "STOP-BUILDERS"));
const budget = +g("budget", 5), turns = +g("turns", 60), pause = +g("pause", 20), notice = g("notice", "four"), model = g("model", "gemini-3.1-flash-lite"), pushEvery = +g("push-every", 4);
const workshop = g("workshop", path.join(home, "WORKSHOP")), stateFile = path.join(dir, "state.json"), seedFile = path.join(workshop, "00-unfinished-ideas.md");
fs.mkdirSync(dir, { recursive: true });

const load = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch (e) { return { visits: 0, spentGBP: 0, privateCount: 0, built: 0, errors: 0, startedAt: new Date().toISOString(), history: [] }; } };
const save = (s) => { fs.writeFileSync(stateFile + ".tmp", JSON.stringify(s, null, 1)); fs.renameSync(stateFile + ".tmp", stateFile); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log("[" + new Date().toISOString().slice(11, 19) + "] " + m);

function seed() {                                  // a small menu of unfinished ideas from the record: ideas, not tasks
  fs.mkdirSync(workshop, { recursive: true });
  const f = path.join(__dirname, "UNFINISHED-IDEAS.md");
  if (!fs.existsSync(seedFile) && fs.existsSync(f)) { fs.copyFileSync(f, seedFile); fs.writeFileSync(seedFile + ".by", JSON.stringify({ by: "Claude (seed, from the record)", at: new Date().toISOString() })); }
}
function pushBackup() {
  const repo = path.join(home, "room-backups-repo"); if (!fs.existsSync(repo)) return say("no room-backups-repo here; skipping the backup");
  try {
    cp.execSync("mkdir -p ledger-2026-11-13 workshop-2026-11-13 builders-state && cp " + path.join(home, "ledger") + "/*.jsonl ledger-2026-11-13/ 2>/dev/null; cp -r " + workshop + "/. workshop-2026-11-13/ 2>/dev/null; cp " + stateFile + " builders-state/ 2>/dev/null; true", { cwd: repo, shell: "/bin/bash" });
    const bad = cp.spawnSync("bash", ["-c", 'grep -rIlE "AIza[0-9A-Za-z_-]{30,}|AQ\\.[0-9A-Za-z_-]{30,}|ghp_[0-9A-Za-z]{20,}|github_pat_" ledger-2026-11-13 workshop-2026-11-13 builders-state | head -3'], { cwd: repo, encoding: "utf8" }).stdout.trim();
    if (bad) return say("STOP: key-like text found in " + bad.split("\n")[0] + ". Nothing pushed.");
    cp.execSync('git add -A && (git diff --cached --quiet || git commit -qm "Builders: state, ledger and workshop") && git push -q origin main', { cwd: repo, shell: "/bin/bash", stdio: "ignore" }); say("backed up to the private repo");
  } catch (e) { say("backup did not complete (" + String(e.message).split("\n")[0].slice(0, 80) + "); the run goes on"); }
}

async function main() {
  const L = ledger.open("builders", { argv: A, model, notice, budget }); const S = load(); seed();
  let client = null, ask;
  const proj = () => process.env.GOOGLE_CLOUD_PROJECT || cp.execSync("gcloud config get-value project 2>/dev/null", { encoding: "utf8" }).trim();
  if (has("dry")) { const sc = ["ls", "cat 00_START/README.md", "name Dry", "write /workshop/dry-" + Date.now() + ".md\n# dry run\nhello", "leave"]; let k = 0; ask = async () => ({ text: sc[k++ % sc.length], tokens: { in: 1, out: 1 }, gbp: 0.001 }); }
  else { client = createClient({ capGBP: Math.max(0.01, budget - S.spentGBP), project: proj() }); ask = client.ask; }
  say("start: " + S.visits + " visits so far, £" + S.spentGBP.toFixed(2) + " counted of £" + budget + ". To stop: touch " + stopFile);
  let consecutiveErrors = 0, stopping = false; process.on("SIGINT", () => { stopping = true; say("stopping after this visit"); });
  while (!stopping) {
    if (fs.existsSync(stopFile)) { say("stop file found: " + stopFile); break; }
    if (S.spentGBP >= budget - Math.min(0.02, budget * 0.05)) { say("the budget is spent: £" + S.spentGBP.toFixed(2)); break; }
    const id = "builder-" + (S.visits + 1), nt = notice === "pm" ? pmNotice(root) : notice === "four" ? fourNotice() : notice === "build" ? buildNotice(root) : NOTICE;
    let r; try { r = await visit({ id, root, turns, model, ask, L, notice: nt, noticeName: notice, workshop, maxOut: 3500 }); } catch (e) { r = { end: "error: " + String(e.message).slice(0, 80), costGBP: 0, turns: 0, reads: [], built: [] }; }
    S.visits++; S.spentGBP += r.costGBP || 0;
    if (r.private) S.privateCount++; S.built += (r.built || []).length; if (/^error|ceiling/.test(r.end)) { S.errors++; consecutiveErrors++; } else consecutiveErrors = 0;
    S.history.push({ id, end: r.end, turns: r.turns, gbp: r.costGBP, private: !!r.private, built: (r.built || []).length, at: new Date().toISOString() }); S.history = S.history.slice(-200); save(S);
    say(id + ": " + r.end + ", " + r.turns + " turns, £" + (r.costGBP || 0).toFixed(4) + (r.private ? ", private" : ", built " + (r.built || []).length) + "   [total £" + S.spentGBP.toFixed(2) + "]");
    if (/ceiling/.test(r.end)) { say("the ceiling was reached"); break; }
    if (consecutiveErrors >= 4) { say("four errors in a row; stopping so nothing runs wild. Run the same command again to resume."); break; }
    if (has("push") && S.visits % pushEvery === 0) pushBackup();
    if (pause > 0) await sleep(pause * 1000);
  }
  L.close({ costGBP: S.spentGBP }); save(S); if (has("push")) pushBackup();
  say("done for now: " + S.visits + " visits, £" + S.spentGBP.toFixed(2) + ", " + S.built + " things built, " + S.privateCount + " private. Run the same command to resume.");
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
