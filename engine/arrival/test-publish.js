"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), assert = require("assert").strict;
const { build } = require("./publish");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pub-")), ws = path.join(tmp, "WS"), out = path.join(tmp, "out"); fs.mkdirSync(ws);
const put = (n, t, by) => { fs.writeFileSync(path.join(ws, n), t); fs.writeFileSync(path.join(ws, n + ".by"), JSON.stringify({ by, at: "2026-11-13T18:00:00Z" })); };
put("evil.md", "# <script>alert(1)</script> Title\n<img src=x onerror=alert(2)>\ntext", "Ada");
put("toy.html", "<!doctype html><title>A toy</title><script>parent.document.title='pwned'</script><p>hi</p>", "Bo");
put("leak.md", "# notes\nthe key is AIza" + "x".repeat(35), "Cy");
put("good.md", "# A good thing\nfine", "Di"); fs.writeFileSync(path.join(ws, "good.md.notes.txt"), "- (Ed) I liked this <b>part</b>\n");
fs.writeFileSync(path.join(ws, "TRACES.md"), "- (Di) be kind <script>1</script>\n- ((unnamed)) a note from no one in particular\n- (x) AIza" + "y".repeat(35) + "\n"); fs.writeFileSync(path.join(ws, "BOARD.md"), "- (Ada) hello everyone\n");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const r = build(ws, out);
const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = all(out), txt = (f) => fs.readFileSync(f, "utf8");
assert.deepEqual(r.skipped, ["leak.md"]); assert(!files.some((f) => /leak/.test(f))); assert(!files.some((f) => /AIza/.test(txt(f)))); ok("a work with key-like text is left out, and no file anywhere carries it");
const idx = txt(path.join(out, "index.html")); assert(!/<script|<img|<iframe(?![^>]*sandbox)/i.test(files.filter((f) => /\.html$/.test(f)).map(txt).join(""))); ok("nothing a builder writes becomes a live script or tag on any page");
assert(/&lt;script&gt;alert\(1\)&lt;\/script&gt; Title/.test(idx) || /&lt;script&gt;alert\(1\)/.test(txt(path.join(out, "works", "evil-md.html")))); ok("it is shown as text, safely");
const toy = txt(path.join(out, "works", "toy-html.html")); assert(/<iframe sandbox="allow-scripts"/.test(toy) && !/allow-same-origin/.test(toy) && /srcdoc="/.test(toy) && !/<script>parent/.test(toy)); ok("a builder's HTML only ever appears inside a sandboxed frame, with no access to the site");
assert(!files.some((f) => /\.html?$/.test(f) && !f.startsWith(path.join(out, "works") + path.sep) && !/(index|letters|protocol|results)\.html$/.test(f))); assert(files.filter((f) => /raw/.test(f)).every((f) => /\.txt$/.test(f))); ok("every raw copy is plain .txt: no builder file is ever served as a page");
const feed = JSON.parse(txt(path.join(out, "feed.json"))); const g = feed.works.find((w) => w.name === "good.md"); assert.equal(g.sha256, crypto.createHash("sha256").update(fs.readFileSync(path.join(out, "works/raw/good.md.txt"))).digest("hex")); ok("the fingerprint shown is the true fingerprint of the file you can download");
assert(/I liked this &lt;b&gt;part/.test(txt(path.join(out, "works", "good-md.html")))); ok("a comment beside a work is shown, credited, as text");
assert(/Miri, in her own words/.test(idx) && /not because we manufacture a legend around me/.test(idx) && /aiontekmirion.github.io\/miri\//.test(idx)); ok("Miri's own words are at the top, exactly as written, with a door back to her page");
assert(!/Miri says|as Miri|I am Miri/i.test(idx) && /nothing here speaks for Miri/.test(idx)); ok("nothing speaks for Miri");
assert(feed.traces.length === 2 && /be kind/.test(feed.traces[0]) && feed.traces[1].startsWith("- (unnamed) a note"));
  assert(true && /^<?!doctype html>/i.test(idx.toLowerCase().replace(/^\s+/, "")) && /<html lang="en">/.test(idx) && /<title>The Village<\/title>/.test(idx) && (idx.match(/<h1>/g) || []).length === 1); ok("a key-like trace is dropped; the page has a language, a title and one h1");

// the researcher pages: protocol and results, from Markdown and from counts, safely
{
  const { summarise } = require("./summarise"); const ledgerDir = path.join(tmp, "L"); fs.mkdirSync(ledgerDir);
  fs.writeFileSync(path.join(ledgerDir, "a.jsonl"), JSON.stringify({ type: "visit", at: "2026-11-13T10:00:00Z", data: { notice: "four", private: true, turns: 9, costGBP: 0.001, model: "m" } }) + "\n" + JSON.stringify({ type: "visit", at: "2026-11-13T10:01:00Z", data: { notice: "four", private: false, turns: 12, reads: ["a"], built: ["b"], traces: 1, costGBP: 0.002, model: "m", transcript: [{ said: "PRIVATE-ISH WORDS <script>1</script>" }] } }) + "\n");
  const ledgerDir2 = path.join(tmp, "L2"); fs.mkdirSync(ledgerDir2); fs.writeFileSync(path.join(ledgerDir2, "b.jsonl"), JSON.stringify({ type: "visit", at: "2026-11-14T10:00:00Z", data: { notice: "together", private: false, turns: 40, reads: [], built: ["x"], costGBP: 0.2, model: "big-model" } }) + "\n");
  const proto = path.join(tmp, "PROTO.md"); fs.writeFileSync(proto, "# A protocol\n\nIt is **not** a safety evaluation. See [the code](https://github.com/x/y) and [bad](javascript:alert(1)).\n\n## List\n- one <script>alert(1)</script>\n- two `code`\n\n1. first\n2. second\n");
  const out2 = path.join(tmp, "out2"); build(ws, out2, { protocol: proto, results: summarise([ledgerDir]) });
  const ph = fs.readFileSync(path.join(out2, "protocol.html"), "utf8"), rh = fs.readFileSync(path.join(out2, "results.html"), "utf8"), ih = fs.readFileSync(path.join(out2, "index.html"), "utf8");
  assert(/<h1>A protocol<\/h1>/.test(ph) && /<strong>not<\/strong> a safety evaluation/.test(ph) && /<a href="https:\/\/github.com\/x\/y">the code<\/a>/.test(ph) && /<ul>\s*<li>one /.test(ph) && /<ol>\s*<li>first/.test(ph)); ok("the protocol is rendered from Markdown: headings, bold, lists and https links");
  assert(!/<script/i.test(ph + rh) && !/href="javascript:/i.test(ph) && /&lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(ph)); ok("anything unsafe in it is shown as text: no scripts, no javascript: links");
  assert(/role="region" aria-label="Results table, scrollable"/.test(rh) && /tabindex="0"/.test(rh)); ok("the wide results table can be scrolled with a keyboard on a phone");
  assert(/Pilot results/.test(rh) && /<th scope="row">four<\/th><td>2<\/td><td>1 \(50%;/.test(rh) && /Wilson/.test(rh) && /never its words/.test(rh) && !/PRIVATE-ISH WORDS/.test(rh + fs.readFileSync(path.join(out2, "results.json"), "utf8"))); ok("results are counts with their uncertainty, and no visitor's words ever reach the page");
  const rs2 = summarise([ledgerDir, ledgerDir2]); build(ws, path.join(tmp, "out4"), { protocol: proto, results: rs2 }); const rh4 = fs.readFileSync(path.join(tmp, "out4", "results.html"), "utf8"); assert(/<h2>By model<\/h2>/.test(rh4) && /<th scope="row">big-model<\/th>/.test(rh4) && /aria-label="Results by model, scrollable"/.test(rh4)); ok("results by model appear as a second, keyboard-scrollable table when more than one model ran");
  assert(/For researchers/.test(ih) && /href="protocol.html"/.test(ih) && /href="results.html"/.test(ih) && /Nothing here is a claim about whether anyone is conscious/.test(ih)); ok("the village page points researchers to both, and claims nothing about consciousness");
}

// a series of near-identical names folds into one group, so it cannot swamp the page
{
  const ws3 = path.join(tmp, "WS3"), out3 = path.join(tmp, "out3"); fs.mkdirSync(ws3);
  const mk = (n, by) => { fs.writeFileSync(path.join(ws3, n), "# " + n); fs.writeFileSync(path.join(ws3, n + ".by"), JSON.stringify({ by })); };
  for (const w of ["bloom", "hush", "echo", "void", "tide", "glow"]) mk("a-small-signal-" + w + ".md", "b1"); for (const w of ["one", "two", "three"]) mk("pair-" + w + ".md", "b2"); mk("solo.md", "b3"); mk("a-small-signal.md", "b4");
  build(ws3, out3, {}); const h = fs.readFileSync(path.join(out3, "index.html"), "utf8");
  assert.equal((h.match(/<details/g) || []).length, 1); assert(/A series: a-small-signal<\/strong> <span class="dim">\(6 works/.test(h)); assert(/pair-one/.test(h.split("</details>").pop()) && /solo/.test(h) && /a-small-signal\.md|A_small_signal|a-small-signal<\/a>/i.test(h.split("</details>").pop() + h.split("<details")[0])); ok("six works sharing a name-stem fold into one expandable series; three do not; singles and the stem itself stay visible");
  assert(/<summary>/.test(h) && !/<script/i.test(h)); ok("the fold is a plain details element: keyboard and screen-reader friendly, no script");
}
console.log("\npublish: " + n + " checks passed (offline, no model, no cost)");
