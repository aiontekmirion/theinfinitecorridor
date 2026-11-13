"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cont-")); const env = Object.assign({}, process.env, { HOME: tmp });
const root = path.join(tmp, "SRC"); fs.mkdirSync(path.join(root, "00_START"), { recursive: true }); fs.mkdirSync(path.join(root, "10_SPINE"), { recursive: true }); fs.writeFileSync(path.join(root, "00_START/README.md"), "hello"); fs.writeFileSync(path.join(root, "10_SPINE/START.md"), "## 7. The house rules\n1. Look.\n## 8. x\n");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const run = (extra) => cp.spawnSync("node", [path.join(__dirname, "continue.js"), "--root", root, "--dry", "--pause", "0", "--turns", "10"].concat(extra), { env, encoding: "utf8" });
let r = run(["--budget", "0.003"]); const st = () => JSON.parse(fs.readFileSync(path.join(tmp, "builders/state.json"), "utf8"));
assert(/the budget is spent/.test(r.stdout)); const first = st(); assert(first.visits >= 1 && first.visits <= 4); ok("it stops when the budget is spent, and says so");
const was = first.visits; r = run(["--budget", "0.006"]); assert(st().visits > was); assert(st().spentGBP >= first.spentGBP); ok("run again and it resumes from the same place, with the money already counted");
fs.writeFileSync(path.join(tmp, "STOP-BUILDERS"), ""); const v = st().visits; r = run(["--budget", "5"]); assert(/stop file found/.test(r.stdout)); assert.equal(st().visits, v); ok("the stop file stops it before another visit starts");
fs.unlinkSync(path.join(tmp, "STOP-BUILDERS")); r = run(["--budget", String(st().spentGBP + 0.005)]); assert(st().visits > v); ok("remove the stop file and it runs again");
assert(fs.existsSync(path.join(tmp, "WORKSHOP/00-unfinished-ideas.md")) && fs.readdirSync(path.join(tmp, "WORKSHOP")).filter((f) => /^dry-/.test(f) && !/\.by$/.test(f)).length >= 1); ok("the workshop is seeded with unfinished ideas, and what builders write stays");
assert(JSON.parse(fs.readFileSync(path.join(tmp, "WORKSHOP/00-unfinished-ideas.md.by"), "utf8")).by.startsWith("Claude")); ok("the seed is credited to who made it");
assert(true);
r = run(["--budget", "0.02", "--publish"]); assert(/village page rebuilt/.test(r.stdout)); assert(fs.existsSync(path.join(tmp, "village-out/index.html"))); assert(/The Village/.test(fs.readFileSync(path.join(tmp, "village-out/index.html"), "utf8"))); ok("--publish rebuilds the village page from the workshop after each visit, so everything built lands on one site");
// the real push: against a local stand-in for GitHub. 'LIVE' is claimed only when the page truly reached the remote.
{
  const sh = (c, cwd) => cp.execSync(c, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { HOME: tmp }) });
  const remote = path.join(tmp, "remote.git"); sh("git init -q --bare -b main " + remote, tmp); const seed = path.join(tmp, "seed"); fs.mkdirSync(seed); sh("git init -q -b main", seed); fs.writeFileSync(path.join(seed, "README.md"), "site"); sh('git add -A && git -c user.name=t -c user.email=t@t commit -qm init && git remote add origin ' + remote + " && git push -q origin main", seed);
  sh("git clone -q " + remote + " " + path.join(tmp, "site-work"), tmp);
  r = run(["--state", path.join(tmp, "st-live"), "--budget", "0.02", "--publish", "--together", "--parallel", "2", "--stagger", "0"]); assert(/web publishing is LIVE/.test(r.stdout), r.stdout.slice(0, 400)); assert(/published: https:\/\/aiontekmirion.github.io\/village\//.test(r.stdout));
  const shown = sh("git --git-dir=" + remote + " show main:village/index.html", tmp); assert(/The Village/.test(shown)); ok("a real push reaches the remote, and only then is 'LIVE' claimed");
  const author = sh("git --git-dir=" + remote + " log -1 --format=%an main", tmp).trim(); assert.equal(author, "The Village (automatic)"); ok("the automatic commit says plainly that it is automatic");
  fs.rmSync(path.join(tmp, "site-work"), { recursive: true }); fs.mkdirSync(path.join(tmp, "site-work")); sh("git init -q -b main", path.join(tmp, "site-work")); sh("git remote add origin /nonexistent/nowhere.git", path.join(tmp, "site-work"));
  r = run(["--state", path.join(tmp, "st-dead"), "--budget", "0.02", "--publish", "--together", "--parallel", "2", "--stagger", "0"]); assert(!/web publishing is LIVE/.test(r.stdout) && /not set up/.test(r.stdout) && /could not push the village page/.test(r.stdout)); ok("when the push fails, it says so, and never claims LIVE");
}
console.log("\ncontinue: " + n + " checks passed (offline, no model, no cost)");
