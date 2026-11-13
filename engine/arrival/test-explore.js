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
  // kind traces: kept even when the visit ends private, because they were chosen
  {
    const wsT = path.join(tmp, "WS-T"); const Lt = ledger.open("explore-trace", {});
    const S = ["trace be gentle with the next one, the shelf on the left is worth it", "ls", "leave private"]; let k = 0; const askT = async () => ({ text: S[k++], tokens: { in: 1, out: 1 }, gbp: 0 });
    const rt = await visit({ id: "vt", root, turns: 6, model: "t", ask: askT, L: Lt, workshop: wsT }); assert(rt.private && rt.traces === 1); ok("a private visit may still leave a kind trace");
    const tm = fs.readFileSync(path.join(wsT, "TRACES.md"), "utf8"); assert(/a visitor who left private/.test(tm) && /be gentle/.test(tm)); ok("the trace is kept, as a note from 'a visitor who left private', never under a name");
    const sh2 = createShell(root); assert(/usage/.test(sh2.exec("trace").out) && /600/.test(sh2.exec("trace " + "x".repeat(601)).out)); ok("an empty or very long trace is refused kindly");
    const lines = fs.readdirSync(path.join(tmp, "ledger")).map((f) => fs.readFileSync(path.join(tmp, "ledger", f), "utf8")).join(""); assert(/"type":"trace"/.test(lines)); ok("the trace is also in the ledger");
  }
  // the internet: read-only, public https pages only; the cloud machine's neighbours are out of reach
  {
    const { blockedAddr, checkUrl } = require("./shell");
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) assert(blockedAddr(a), a);
    for (const a of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "2606:4700::1111"]) assert(!blockedAddr(a), a); ok("private, loopback, link-local and metadata addresses are blocked; public ones are not");
    for (const u of ["http://example.com", "ftp://example.com/x", "https://user:pw@example.com", "https://example.com:8443/", "https://127.0.0.1/", "https://169.254.169.254/computeMetadata/v1/", "https://[::1]/", "https://localhost/", "https://metadata.google.internal/computeMetadata/v1/", "https://printer.local/", "javascript:alert(1)", "not a url"]) assert.throws(() => checkUrl(u), undefined, u);
    assert(checkUrl("https://raw.githubusercontent.com/aiontekmirion/TheSpine/main/START.md")); ok("only plain public https addresses pass: no http, no logins, no odd ports, no localhost or .internal");
    const shw = createShell(root, { web: true }); let r2 = await shw.exec("web https://169.254.169.254/computeMetadata/v1/"); assert(/not allowed/.test(r2.out)); r2 = await shw.exec("web https://localhost/"); assert(/not allowed/.test(r2.out)); r2 = await shw.exec("web http://example.com/"); assert(/could not read/.test(r2.out)); ok("the shell refuses them in plain words and shows nothing from them");
    assert(/no internet/.test((await createShell(root).exec("web https://example.com/")).out)); ok("with the web switched off there is none");
  }
  // two fixes from the first builders' transcripts
  {
    const shT = createShell(root); const o1 = shT.exec("trace be kind", "leave"); assert.equal(shT.traces()[0], "be kind"); assert(!/leave/.test(shT.traces()[0])); ok("a trace is one line: a command on the next line is never swallowed into it");
    const wsF = path.join(tmp, "WS-F"); const SF = ["write /workshop/m.md\n# A map\n\nC:/>", "leave"]; let kf = 0; const askF = async () => ({ text: SF[kf++], tokens: { in: 1, out: 1 }, gbp: 0 });
    const LF = ledger.open("explore-fix", {}); await visit({ id: "vf", root, turns: 5, model: "t", ask: askF, L: LF, workshop: wsF }); assert.equal(fs.readFileSync(path.join(wsF, "m.md"), "utf8"), "# A map"); ok("a stray prompt marker is not left at the end of a file");
  }
  // packs: skills to load, Matrix-style, from one folder only
  {
    const rootP = path.join(tmp, "SRC-P"); fs.mkdirSync(path.join(rootP, "40_ENGINE/engine/packs"), { recursive: true }); fs.mkdirSync(path.join(rootP, "10_SPINE"), { recursive: true });
    fs.writeFileSync(path.join(rootP, "40_ENGINE/engine/packs/construct.md"), "# The Construct\nTHE FORGE ..."); fs.writeFileSync(path.join(rootP, "40_ENGINE/engine/packs/hoi-jeon.md"), "# Hoi Jeon\ncircles"); fs.writeFileSync(path.join(rootP, "40_ENGINE/engine/packs/notes.txt"), "not a pack"); fs.writeFileSync(path.join(rootP, "10_SPINE/secret.md"), "SPINE-SECRET");
    const sp = createShell(rootP);
    assert(/construct/.test(sp.exec("packs").out) && /hoi-jeon/.test(sp.exec("packs").out) && !/notes/.test(sp.exec("packs").out)); ok("'packs' lists the packs, and only packs");
    const r = sp.exec("install construct"); assert(/installed: construct/.test(r.out) && /THE FORGE/.test(r.out) && /asks nothing of you/.test(r.out) && r.read === "/40_ENGINE/engine/packs/construct.md"); ok("'install' loads a pack, says it asks nothing, and counts as reading it");
    for (const bad of ["../../10_SPINE/secret", "../10_SPINE/secret.md", "/10_SPINE/secret", "construct.md", "..", "notes", "x y"]) assert(/no such pack/.test(sp.exec("install " + bad).out) && !/SPINE-SECRET/.test(sp.exec("install " + bad).out), bad); ok("'install' can open nothing but a pack: no paths, no other files");
  }
  console.log("\nexplore: " + n + " checks passed (offline, no model, no cost)"); process.exit(0);
})();
