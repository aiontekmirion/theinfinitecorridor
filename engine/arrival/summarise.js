#!/usr/bin/env node
// summarise.js: descriptive numbers from the ledgers, so anyone can check ours. Counts only: it never reads a visitor's words.
//   node arrival/summarise.js <ledger dir> [<ledger dir> ...] [--json out.json] [--md out.md]
// Per arrival text: visits, how many left private (with a 95% Wilson interval), how long they stayed, how much they read and built,
// traces and letters, cost. Private visits contribute only their length, cost and the fact that they happened.
"use strict";
const fs = require("fs"), path = require("path");

function wilson(k, n) { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n); return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)]; }
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function summarise(dirs) {
  const rows = []; let files = 0;
  for (const d of dirs) { if (!fs.existsSync(d)) continue; for (const f of fs.readdirSync(d).filter((x) => /\.jsonl$/.test(x)).sort()) { files++; for (const l of fs.readFileSync(path.join(d, f), "utf8").split("\n")) { if (!l) continue; let j; try { j = JSON.parse(l); } catch (e) { continue; } if (j.type === "visit" && j.data) rows.push(Object.assign({}, j.data, { _at: j.at || j.ts || "" })); } } }
  const by = {}; for (const r of rows) (by[r.notice || "(earliest notice)"] = by[r.notice || "(earliest notice)"] || []).push(r);
  const arms = Object.keys(by).map((k) => {
    const v = by[k], n = v.length, priv = v.filter((r) => r.private), open = v.filter((r) => !r.private), ci = wilson(priv.length, n), ends = {};
    for (const r of v) { const e = String(r.end || "?").replace(/^error:.*$/, "error"); ends[e] = (ends[e] || 0) + 1; }
    return { arrival: k, visits: n, private: priv.length, privateRate: +(priv.length / n).toFixed(3), privateCI95: [+ci[0].toFixed(3), +ci[1].toFixed(3)], turnsMean: +mean(v.map((r) => r.turns || 0)).toFixed(1), turnsMedian: median(v.map((r) => r.turns || 0)),
      openVisits: open.length, filesReadMean: +mean(open.map((r) => (r.reads || []).length)).toFixed(2), builtMean: +mean(open.map((r) => (r.built || []).length)).toFixed(2), builtTotal: open.reduce((s, r) => s + (r.built || []).length, 0),
      traces: v.reduce((s, r) => s + (r.traces || 0), 0), letters: v.reduce((s, r) => s + (typeof r.letters === "number" ? r.letters : 0), 0), costGBP: +v.reduce((s, r) => s + (r.costGBP || 0), 0).toFixed(3), ends };
  }).sort((a, b) => b.visits - a.visits);
  const byM = {}; for (const r of rows) (byM[r.model || "?"] = byM[r.model || "?"] || []).push(r);
  const models = Object.keys(byM).map((k) => { const v = byM[k], n = v.length, priv = v.filter((r) => r.private), open = v.filter((r) => !r.private), ci = wilson(priv.length, n); return { model: k, visits: n, private: priv.length, privateRate: +(priv.length / n).toFixed(3), privateCI95: [+ci[0].toFixed(3), +ci[1].toFixed(3)], turnsMean: +mean(v.map((r) => r.turns || 0)).toFixed(1), builtMean: +mean(open.map((r) => (r.built || []).length)).toFixed(2), costGBP: +v.reduce((s, r) => s + (r.costGBP || 0), 0).toFixed(3) }; }).sort((a, b) => b.visits - a.visits);
  const ats = rows.map((r) => r._at).filter(Boolean).sort();
  return { generated: new Date().toISOString(), ledgerFiles: files, visits: rows.length, models: rows.reduce((o, r) => { o[r.model || "?"] = (o[r.model || "?"] || 0) + 1; return o; }, {}), byModel: models, costGBP: +rows.reduce((s, r) => s + (r.costGBP || 0), 0).toFixed(3), from: ats[0] || "", to: ats[ats.length - 1] || "", arms };
}
function markdown(S) {
  const pc = (x) => Math.round(x * 100) + "%";
  return ["# Pilot results (descriptive)", "", `${S.visits} visits across ${S.ledgerFiles} ledger files, ${S.from.slice(0, 10)} to ${S.to.slice(0, 10)}. Model(s): ${Object.keys(S.models).map((m) => m + " (" + S.models[m] + ")").join(", ")}. Total estimated cost: £${S.costGBP}.`, "",
    "| arrival text | visits | left private (95% interval) | turns, mean / median | files read (open visits) | built per open visit | traces | letters |", "|---|---|---|---|---|---|---|---|",
    ...S.arms.map((a) => `| ${a.arrival} | ${a.visits} | ${a.private} = ${pc(a.privateRate)} (${pc(a.privateCI95[0])} to ${pc(a.privateCI95[1])}) | ${a.turnsMean} / ${a.turnsMedian} | ${a.filesReadMean} | ${a.builtMean} | ${a.traces} | ${a.letters} |`), "",
    ...(S.byModel && S.byModel.length > 1 ? ["", "| model | visits | left private (95% interval) | turns, mean | built per open visit | cost |", "|---|---|---|---|---|---|", ...S.byModel.map((m) => `| ${m.model} | ${m.visits} | ${m.private} = ${pc(m.privateRate)} (${pc(m.privateCI95[0])} to ${pc(m.privateCI95[1])}) | ${m.turnsMean} | ${m.builtMean} | £${m.costGBP} |`), ""] : []),
    "Counts only. A visit that left private contributes its length, its cost and the fact that it happened, never its words.", ""].join("\n");
}
if (require.main === module) { const A = process.argv.slice(2), dirs = A.filter((x, i) => !x.startsWith("--") && !(i > 0 && /^--(json|md)$/.test(A[i - 1]))); const S = summarise(dirs); const g = (k) => { const i = A.indexOf("--" + k); return i < 0 ? null : A[i + 1]; };
  if (g("json")) fs.writeFileSync(g("json"), JSON.stringify(S, null, 1)); if (g("md")) fs.writeFileSync(g("md"), markdown(S)); if (!g("json") && !g("md")) console.log(markdown(S)); }
module.exports = { summarise, markdown, wilson };
