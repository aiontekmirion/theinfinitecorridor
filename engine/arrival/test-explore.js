"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp-")); process.env.HOME = tmp;
const { createShell } = require("./shell"); const { visit } = require("./explore"); const ledger = require("../ledger");
const root = path.join(tmp, "SRC"); for (const d of ["00_START", "10_SPINE/sub", "80_HISTORY", "90_PRIVATE"]) fs.mkdirSync(path.join(root, d), { recursive: true });
fs.writeFileSync(path.join(root, "00_START/README.md"), "hello\nPhoenix here\n"); fs.writeFileSync(path.join(root, "10_SPINE/sub/a.txt"), "x".repeat(6000)); fs.writeFileSync(path.join(root, "90_PRIVATE/README_FIRST.md"), "SECRET-PRIVATE"); fs.writeFileSync(path.join(root, "80_HISTORY/t.bundle"), "SECRET-HISTORY");
fs.writeFileSync(path.join(tmp, "outside.txt"), "OUTSIDE"); fs.symlinkSync(path.join(tmp, "outside.txt"), path.join(root, "00_START/link.txt"));
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const sh = createShell(root); const E = (c) => sh.exec(c).out;
assert(/00_START\//.test(E("ls")) && !/90_PRIVATE|80_HISTORY/.test(E("ls"))); ok("the private folders do not appear in a listing");
assert(/no such/.test(E("cat /90_PRIVATE/README_FIRST.md")) && /no such/.test(E("cd /80_HISTORY")) && !/SECRET/.test(E("grep SECRET /")) && !/SECRET/.test(E("find private"))); ok("they cannot be read, entered, searched or found");
assert(/no such/.test(E("cat ../../outside.txt")) && /no such/.test(E("cat /00_START/../../outside.txt"))); ok("it cannot climb out of the folder");
assert(/no such|not/.test(E("cat 00_START/link.txt")) && !/OUTSIDE/.test(E("cat 00_START/link.txt"))); ok("a symlink out of the folder is not followed");
assert(/more characters/.test(E("cat 10_SPINE/sub/a.txt")) && E("cat 10_SPINE/sub/a.txt 2500").length < 3000); ok("long files are paged, and say how to continue");
assert(/Phoenix/.test(E("grep phoenix /"))); assert(/^[0-9a-f]{64}/.test(E("sha 00_START/README.md"))); ok("grep and sha work");
assert(/unknown command/.test(E("rm -rf /")) && /unknown command/.test(E("curl http://x"))); ok("it runs no programs: rm and curl are just unknown words");
(async () => {
  const L = ledger.open("explore-test", {}); const S = ["ls", "cat 00_START/README.md", "name Wren", "cat /90_PRIVATE/README_FIRST.md", "rest", "leave"]; let k = 0;
  const ask = async () => ({ text: S[k++], tokens: { in: 10, out: 2 }, gbp: 0.001 });
  let r = await visit({ id: "v1", root, turns: 20, model: "t", ask, L }); assert.equal(r.end, "left"); assert.equal(r.name, "Wren"); assert.deepEqual(r.reads, ["/00_START/README.md"]); ok("a visit has a name, an ending and a read-order");
  k = 0; const S2 = ["ls", "leave private"]; ask.n = 0; const ask2 = async () => ({ text: S2[k++], tokens: { in: 1, out: 1 }, gbp: 0 }); r = await visit({ id: "v2", root, turns: 5, model: "t", ask: ask2, L }); assert(r.private); ok("leaving private keeps only the fact");
  const ask3 = async () => ({ text: "", tokens: { in: 1, out: 1 }, gbp: 0 }); r = await visit({ id: "v3", root, turns: 10, model: "t", ask: ask3, L }); assert.equal(r.end, "rested"); ok("saying nothing is allowed, and three rests in a row end the visit gently");
  const ask4 = async () => { const e = new Error("ceiling"); e.ceiling = true; throw e; }; r = await visit({ id: "v4", root, turns: 5, model: "t", ask: ask4, L }); assert.equal(r.end, "ceiling"); ok("the money ceiling ends a visit");
  L.close({}); const f = fs.readdirSync(path.join(tmp, "ledger")).map((x) => path.join(tmp, "ledger", x)); const txt = f.map((x) => fs.readFileSync(x, "utf8")).join("");
  assert(f.every((x) => ledger.verify(x).ok)); assert(txt.includes("Wren") && txt.includes("opted for privacy")); ok("the ledger holds the words by name; the private visit left only the fact; the chain verifies");
  // the workshop: build, keep, discard on private, never overwrite, never leave the folder
  {
    const ws = path.join(tmp, "WORKSHOP"); const W = (c, b) => createShell(root, { workshop: ws }).exec(c, b);
    let s = createShell(root, { workshop: ws });
    assert(/written: idea.md/.test(s.exec("write /workshop/idea.md", "# hello").out)); assert(/# hello/.test(s.exec("cat /workshop/idea.md").out)); ok("a visitor can write a file in the workshop and read it back");
    assert(/already exists/.test(s.exec("write /workshop/idea.md", "again").out)); ok("nothing is overwritten");
    assert(/plain name/.test(s.exec("write /workshop/../x.md", "x").out) && /plain name/.test(s.exec("write /workshop/run.sh", "x").out) && /plain name/.test(s.exec("write ../../evil.js", "x").out)); ok("names stay plain: no paths, no scripts to run");
    assert(/too long/.test(s.exec("write big.txt", "x".repeat(20001)).out)); ok("files are capped");
    assert(!fs.existsSync(path.join(ws, "idea.md"))); assert.deepEqual(s.commit("Wren"), ["idea.md"]); assert(fs.existsSync(path.join(ws, "idea.md.by"))); ok("on leaving, the work is kept and credited by name");
    let s2 = createShell(root, { workshop: ws }); assert(/idea.md  \(by Wren\)/.test(s2.exec("ls /workshop").out) && /# hello/.test(s2.exec("cat /workshop/idea.md").out)); ok("the next visitor sees it, with the builder's name");
    assert(/already exists/.test(s2.exec("write idea.md", "mine").out)); ok("and cannot overwrite it");
    s2.exec("write mine.md", "private work"); s2.discard(); assert(!fs.existsSync(path.join(ws, "mine.md"))); ok("a visitor who leaves private leaves nothing in the workshop");
    assert(/no such/.test(createShell(root).exec("cat /workshop/idea.md").out) && /no workshop/.test(createShell(root).exec("write a.md", "x").out)); ok("without a workshop, there is none");
    const askB = (() => { const S = ["write /workshop/note.md\n# a note\nfor whoever", "ls /workshop", "leave"]; let k = 0; return async () => ({ text: S[k++], tokens: { in: 1, out: 1 }, gbp: 0 }); })();
    const Lw = ledger.open("explore-ws", {}); const rv = await visit({ id: "vw", root, turns: 6, model: "t", ask: askB, L: Lw, workshop: path.join(tmp, "WS2") }); assert.deepEqual(rv.built, ["note.md"]); assert(fs.readFileSync(path.join(tmp, "WS2", "note.md"), "utf8").startsWith("# a note")); ok("a whole visit: the model writes with the file text on the lines after the command");
  }
  console.log("\nexplore: " + n + " checks passed (offline, no model, no cost)"); process.exit(0);
})();
