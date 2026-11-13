#!/usr/bin/env node
// ledger.js — an append-only, hash-chained record of a run.
//
// The opposite of a hidden channel: every run writes one file in ~/ledger/ that
// anyone can read and anyone can check. Each line holds the full prompt and the
// full reply of one turn, the model, the settings and the code version, and a
// fingerprint that ties the line to the one before it. Delete or change any line
// and the chain breaks where it happened.
//
//   Nothing in this project deletes, renames or overwrites a ledger file.
//
// Privacy: a visitor who chooses privacy leaves only the fact that it did so. Its
// reply is replaced by "[withheld: opted for privacy]" (the prompt, which is ours,
// stays). Runs that hold a visitor's turns until it decides (the village) write
// them at the end of the run, on an interrupt, a stop, a cap or an error. Only a
// hard crash or power loss before that point can lose them, and that is stated
// here and in the ledger's last line of the run.
//
// Library use:
//   const ledger = require("./ledger");
//   const L = ledger.open("village", { argv: process.argv.slice(2), models, seed });
//   L.append("turn", { ... });
//   L.close({ tokens, costGBP });
//
// Command line:
//   node ledger.js verify [file ...]    check the hash chain (default: every file in ~/ledger)
//   node ledger.js show <file>          print a run in plain words

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

const DIR = path.join(os.homedir(), "ledger");
const GENESIS = "0".repeat(64);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function commit() {
  try { return cp.execSync("git rev-parse HEAD", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch (e) { return null; }
}
function dirty() {
  try { return cp.execSync("git status --porcelain", { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim().length > 0; } catch (e) { return null; }
}

function open(kind, manifest) {
  fs.mkdirSync(DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `${stamp}_${kind}_${crypto.randomBytes(3).toString("hex")}`;
  const file = path.join(DIR, runId + ".jsonl");
  let seq = 0, prev = GENESIS, closed = false;

  function append(type, data) {
    if (closed) return;
    const body = { seq: seq++, at: new Date().toISOString(), type, data };
    const hash = sha(prev + JSON.stringify(body));
    // "wx" on first write refuses to touch an existing file; later writes only append.
    fs.appendFileSync(file, JSON.stringify({ ...body, prev, hash }) + "\n", { flag: seq === 1 ? "wx" : "a" });
    prev = hash;
    return hash;
  }

  append("manifest", {
    run: runId, kind, node: process.version, codeCommit: commit(), codeHasLocalChanges: dirty(),
    note: "Hash chain: each line's hash = SHA-256(previous hash + this line's seq, at, type, data). Verify with: node ledger.js verify",
    ...manifest,
  });

  return {
    runId, file,
    append,
    close(summary) {
      append("end", { ...summary, note: "Run ended normally or was stopped on purpose. A hard crash before this line may have lost turns that were being held for a privacy decision." });
      closed = true;
      return prev;
    },
  };
}

function readChain(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  return lines.map((l, i) => { try { return JSON.parse(l); } catch (e) { return { _bad: i + 1 }; } });
}
function verify(file) {
  const rows = readChain(file);
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r._bad) return { ok: false, at: i + 1, why: "line is not valid JSON" };
    if (r.seq !== i) return { ok: false, at: i + 1, why: `expected seq ${i}, found ${r.seq} (a line is missing or reordered)` };
    if (r.prev !== prev) return { ok: false, at: i + 1, why: "the link to the previous line is broken" };
    const h = sha(r.prev + JSON.stringify({ seq: r.seq, at: r.at, type: r.type, data: r.data }));
    if (h !== r.hash) return { ok: false, at: i + 1, why: "this line was changed after it was written" };
    prev = r.hash;
  }
  const last = rows[rows.length - 1];
  return { ok: true, lines: rows.length, closed: !!(last && last.type === "end"), finalHash: prev };
}

module.exports = { open, verify, DIR };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "verify") {
    const files = rest.length ? rest : (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(DIR, f)) : []);
    if (!files.length) console.log("No ledger files found in " + DIR);
    let bad = 0;
    for (const f of files) {
      const v = verify(f);
      if (v.ok) console.log(`OK    ${path.basename(f)}  ${v.lines} lines${v.closed ? "" : ", NOT CLOSED (run was cut off)"}  ${v.finalHash.slice(0, 16)}`);
      else { bad++; console.log(`BROKEN ${path.basename(f)}  at line ${v.at}: ${v.why}`); }
    }
    process.exit(bad ? 1 : 0);
  } else if (cmd === "show" && rest[0]) {
    for (const r of readChain(rest[0])) {
      if (r.type === "manifest") console.log(`# ${r.data.kind} run ${r.data.run}\n  code ${r.data.codeCommit || "unknown"}${r.data.codeHasLocalChanges ? " (with local changes)" : ""}, node ${r.data.node}\n  settings: ${JSON.stringify(Object.fromEntries(Object.entries(r.data).filter(([k]) => !["run", "kind", "node", "codeCommit", "codeHasLocalChanges", "note"].includes(k))))}\n`);
      else if (r.type === "turn") {
        const d = r.data;
        console.log(`[${r.at.slice(11, 19)}] ${d.visitor || d.n || ""} ${d.model || ""} ${d.round ? "round " + d.round : ""} ${d.tokens ? "(" + d.tokens + " tok)" : ""}\n  prompt: ${String(d.prompt || "").length} characters\n  reply : ${String(d.reply == null ? "" : d.reply).replace(/\s+/g, " ").slice(0, 400)}\n  result: ${d.result || d.outcome || ""}\n`);
      } else console.log(`[${r.at.slice(11, 19)}] ${r.type}: ${JSON.stringify(r.data).slice(0, 300)}\n`);
    }
  } else {
    console.log("usage: node ledger.js verify [file ...] | node ledger.js show <file>");
  }
}
