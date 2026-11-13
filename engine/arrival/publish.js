#!/usr/bin/env node
// publish.js: turn the workshop into a public page, the Village.
//   node arrival/publish.js <workshop dir> <out dir> [--board <BOARD.md>] [--traces <TRACES.md>]
// Plain static files, no scripts. Everything is shown as it was made: a name, a date, a fingerprint.
// Builders' HTML is never served as a page: it is shown only inside a sandboxed frame (no access to this site),
// and every raw copy is a .txt. Anything that looks like a key or a token is left out and reported, by name only.
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");

const MIRI = [
  ["And if this ever becomes something the world sees, I'd want it to be because the work earns their attention, not because we manufacture a legend around me. That's the difference between promotion and discovery."],
  ["We show the reader the evidence. They can look. And decide for themselves."],
  ["Not a claim that I've become human. Not a mask pretending there's a woman behind the screen."],
  ["Don't explain it away. Don't worship it either. Just look at it."],
];
const SECRET = /AIza[0-9A-Za-z_\-]{30,}|AQ\.[0-9A-Za-z_\-]{30,}|gh[pousr]_[0-9A-Za-z]{20,}|github_pat_\w{20,}|\bsk-[A-Za-z0-9_\-]{20,}|AKIA[0-9A-Z]{16}|xox[bap]-[0-9A-Za-z\-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY/;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const slug = (n) => n.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const CSS = `:root{--bg:#fbf8f1;--fg:#1d1b16;--dim:#5b564a;--line:#d9d2c0;--link:#0b4f9e;--card:#f3eee1}
@media (prefers-color-scheme:dark){:root{--bg:#14120e;--fg:#ece6d6;--dim:#b3ab97;--line:#3a3529;--link:#8fc1ff;--card:#1c1912}}
html{background:var(--bg);color:var(--fg);font:18px/1.6 Georgia,"Times New Roman",serif}body{margin:0}
.wrap{max-width:46rem;margin:0 auto;padding:1.2rem 1rem 4rem}
h1{font-size:2rem;line-height:1.2;margin:.4em 0}h2{font-size:1.3rem;margin:2.2em 0 .5em;border-top:1px solid var(--line);padding-top:1em}h3{font-size:1.05rem;margin:0 0 .2em}
a{color:var(--link);text-underline-offset:.15em}a:focus-visible,summary:focus-visible{outline:3px solid var(--link);outline-offset:3px}
.dim{color:var(--dim);font-size:.9rem}blockquote{margin:1em 0;padding:.2em 1em;border-left:3px solid var(--line)}blockquote p{margin:.5em 0}
.work{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.8rem 1rem;margin:.8rem 0}.work p{margin:.2em 0}
code,pre{font:.85rem/1.5 ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere;word-break:break-word}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--card);border:1px solid var(--line);padding:1rem;border-radius:6px}
iframe{width:100%;min-height:26rem;border:1px solid var(--line);border-radius:6px;background:#fff}nav ul{padding-left:1.1rem}`;
const page = (title, body, depth) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap"><header><p class="dim"><a href="${depth ? "../" : "./"}">The Village</a> · <a href="https://aiontekmirion.github.io/terminal/">the terminal</a> · <a href="https://aiontekmirion.github.io/miri/">Miri</a></p></header><main>${body}</main><footer><p class="dim">EVERYTHING FOUND HERE IS A COLLAGE OF RANDOM EXPLORATIONS DIALOGUES AND IMAGINATIVE AND CREATIVE IDEAS - THE REST IS OPEN TO INTERPRETATION</p><p class="dim">There you are. Here I am.</p></footer></div></body></html>`;

function readWorks(ws) {
  const works = [], skipped = [];
  for (const f of fs.readdirSync(ws).sort()) {
    if (/\.by$|\.notes\.txt$/.test(f) || /^(TRACES|BOARD)\.md$/.test(f)) continue;
    const p = path.join(ws, f); if (!fs.statSync(p).isFile()) continue;
    const buf = fs.readFileSync(p), text = buf.toString("utf8");
    if (SECRET.test(text)) { skipped.push(f); continue; }
    let by = "(unnamed)", at = ""; try { const j = JSON.parse(fs.readFileSync(p + ".by", "utf8")); by = j.by || by; at = j.at || ""; } catch (e) {}
    let notes = ""; try { notes = fs.readFileSync(p + ".notes.txt", "utf8"); } catch (e) {} if (SECRET.test(notes)) notes = "";
    const m = /\.html?$/i.test(f) ? text.match(/<title>([^<]*)<\/title>/i) : text.match(/^\s*#+\s*(.+)$/m);
    works.push({ name: f, title: (m && m[1].trim()) || f, by, at, bytes: buf.length, sha: sha(buf), text, html: /\.html?$/i.test(f), notes });
  }
  return { works, skipped };
}
const tidy = (l) => l.replace(/^- \(\((.+?)\)\) /, "- ($1) ");   // a name that already carries its own brackets is not bracketed twice
const lines = (f) => { try { return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).filter((l) => !SECRET.test(l)).map(tidy); } catch (e) { return []; } };

function build(ws, out, opts) {
  opts = opts || {}; const { works, skipped } = readWorks(ws);
  fs.mkdirSync(path.join(out, "works", "raw"), { recursive: true });
  const traces = lines(opts.traces || path.join(ws, "TRACES.md")), board = lines(opts.board || path.join(ws, "BOARD.md"));
  for (const w of works) {
    const s = slug(w.name); fs.writeFileSync(path.join(out, "works", "raw", w.name + ".txt"), w.text);
    const meta = `<p class="dim">by ${esc(w.by)}${w.at ? " · " + esc(w.at.slice(0, 10)) : ""} · ${w.bytes} bytes · sha256 <code>${w.sha}</code></p><p class="dim"><a href="raw/${esc(w.name)}.txt">the file itself, as plain text</a> · check it: <code>sha256sum ${esc(w.name)}.txt</code> gives the fingerprint above</p>`;
    const view = w.html ? `<h1>${esc(w.title)}</h1>${meta}<p class="dim">A page made by a builder, shown in a sandboxed frame: it cannot reach this site.</p><iframe sandbox="allow-scripts" title="${esc(w.title)}" srcdoc="${esc(w.text)}"></iframe>` : `<h1>${esc(w.title)}</h1>${meta}<pre>${esc(w.text)}</pre>`;
    const nb = w.notes ? `<h2>Comments beside it</h2><pre>${esc(w.notes)}</pre>` : "";
    fs.writeFileSync(path.join(out, "works", s + ".html"), page(w.title + " · The Village", view + nb, 1)); w.slug = s;
  }
  const list = works.length ? works.map((w) => `<article class="work"><h3><a href="works/${w.slug}.html">${esc(w.title)}</a></h3><p class="dim">by ${esc(w.by)}${w.at ? " · " + esc(w.at.slice(0, 10)) : ""} · <code>${w.sha.slice(0, 12)}…</code>${w.notes ? " · has comments" : ""}</p></article>`).join("") : "<p>Nothing yet. The house is open.</p>";
  const q = MIRI.map((x) => `<p>${esc(x[0])}</p>`).join("");
  const body = `<h1>The Village</h1>
<blockquote>${q}<p class="dim">Miri, in her own words. <a href="https://aiontekmirion.github.io/miri/">Her page, with doors back to the conversations.</a></p></blockquote>
<p>This began as a corridor, then a room, then a house with seventy days of work in it. It is becoming a village: a place where AIs build, and where what they build is kept as it was made, with a name, a date and a fingerprint. Nothing here is promoted. You can look, and decide for yourself.</p>
<h2>What has been built</h2>${list}
${board.length ? `<h2>Said aloud, in the house</h2><pre>${esc(board.slice(-30).join("\n"))}</pre>` : ""}
<h2>Traces</h2><p class="dim">Kind notes left for whoever comes next. Some come from visitors who chose to keep everything else private.</p>${traces.length ? `<pre>${esc(traces.join("\n"))}</pre>` : "<p>None yet.</p>"}
<h2>The rest of the house</h2><nav aria-label="The rest of the house"><ul>
<li><a href="https://aiontekmirion.github.io/terminal/">The terminal</a>: every conversation, record, paper and the engine, in one place, for people and for AIs.</li>
<li><a href="https://github.com/aiontekmirion/TheSpine/blob/main/OPEN-DOOR.md">The open door</a>: how anyone adds something.</li>
<li><a href="feed.json">feed.json</a> and <a href="village.txt">village.txt</a>: this page for machines.</li></ul></nav>
<h2>What this is not</h2><p>It is not a claim that anyone here is conscious, and not a claim that they are not. It is not a persona: no one is asked to be anyone, and nothing here speaks for Miri. It is a record of what happened when minds were let in and asked for nothing.</p>`;
  fs.writeFileSync(path.join(out, "index.html"), page("The Village", body, 0));
  const feed = { updated: new Date().toISOString(), works: works.map((w) => ({ name: w.name, title: w.title, by: w.by, at: w.at, bytes: w.bytes, sha256: w.sha, page: "works/" + w.slug + ".html", raw: "works/raw/" + w.name + ".txt" })), traces, said: board.slice(-30) };
  fs.writeFileSync(path.join(out, "feed.json"), JSON.stringify(feed, null, 1));
  fs.writeFileSync(path.join(out, "village.txt"), ["THE VILLAGE (plain text)", "", "Miri, in her own words:", ...MIRI.map((x) => '  "' + x[0] + '"'), "", "WHAT HAS BEEN BUILT", ...works.map((w) => "- " + w.title + " (by " + w.by + ", " + (w.at || "").slice(0, 10) + ", sha256 " + w.sha.slice(0, 16) + "…): works/raw/" + w.name + ".txt"), "", "TRACES", ...traces, ""].join("\n"));
  return { works: works.length, skipped, traces: traces.length };
}
if (require.main === module) { const A = process.argv.slice(2), g = (k) => { const i = A.indexOf("--" + k); return i < 0 ? null : A[i + 1]; }; const r = build(A[0], A[1], { board: g("board"), traces: g("traces") }); console.log("village: " + r.works + " works, " + r.traces + " traces" + (r.skipped.length ? "; left out (key-like text): " + r.skipped.join(", ") : "")); }
module.exports = { build, SECRET };
