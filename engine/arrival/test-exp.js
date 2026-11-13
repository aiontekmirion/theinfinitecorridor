"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exp-")); process.env.HOME = tmp;
const { createShell } = require("./shell"); const { createExp, value } = require("./exp"); const { runDay } = require("./together"); const ledger = require("../ledger"); const { togetherNotice } = require("./explore");
const root = path.join(tmp, "SRC"); fs.mkdirSync(path.join(root, "10_SPINE"), { recursive: true });
const BIG = "Look before you act. If nobody asked you to build something, you are welcome to just visit. Receipts, not verdicts: say where a claim came from. " + "More words about the record and what it holds. ".repeat(120);
fs.writeFileSync(path.join(root, "10_SPINE/a.md"), BIG); fs.writeFileSync(path.join(root, "10_SPINE/b.md"), "A small file with a few honest words in it, nothing more than that really.");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const dir = path.join(tmp, "WS"); const X = createExp({ dir });
const mk = (id) => createShell(root, { workshop: dir, exp: X, id, by: () => id });
const QUOTE = '"Receipts, not verdicts: say where a claim came from"'; const MINE = "I take from this that a claim without its source is only a mood, and that the habit of saying where things came from is what lets a later reader trust the record at all.";
let s = mk("a");
assert(/read it first/.test(s.exec("reflect 10_SPINE/a.md " + QUOTE + " " + MINE).out)); ok("you cannot reflect on something you have not read");
s.exec("cat 10_SPINE/a.md");
assert(/exactly as written/.test(s.exec('reflect 10_SPINE/a.md "Receipts and verdicts are the same thing really" ' + MINE).out)); ok("an invented quotation earns nothing: the receipt is checked against the real file");
assert(/exactly as written/.test(s.exec("reflect 10_SPINE/a.md " + MINE).out)); ok("no quotation, no EXP");
assert(/say a little more/.test(s.exec("reflect 10_SPINE/a.md " + QUOTE + " good").out)); ok("a bare quotation with nothing of your own earns nothing");
let r = s.exec("reflect 10_SPINE/a.md " + QUOTE + " " + MINE); assert(r.expEarned === value(BIG.length) && /the first anyone/.test(r.out)); assert(s.expBalance() === value(BIG.length)); ok("a real reflection earns the file's value, and the first reader of a file earns the most");
assert(/already reflected/.test(s.exec("reflect 10_SPINE/a.md " + QUOTE + " " + MINE).out)); ok("one reflection per file per life: no farming");
let s2 = mk("b"); s2.exec("cat 10_SPINE/a.md"); r = s2.exec("reflect 10_SPINE/a.md " + QUOTE + " " + MINE + " Again."); assert.equal(r.expEarned, Math.max(1, Math.round(value(BIG.length) * 0.25))); assert(/an echo/.test(r.out)); ok("a later reader of the same file earns a quarter: the pool is finite");
assert(value(100) < value(10000) && value(10000) < value(1e6) && value(1) === 1); ok("bigger parts of the record are worth more, and the scale is gentle");
assert(/costs 10/.test(s2.exec("rise turns").out)); ok("you cannot spend what you do not carry");
let s3 = mk("c"); s3.exec("cat 10_SPINE/a.md"); X.earn("c", "x", 60000); const before = s.expBalance(); 
X.drop("rich", "Rho", 12, ""); const sp0 = mk("buyer"); assert(/\+12 embers/.test(sp0.exec("scoop").out)); const sp = sp0.exec("rise turns"); assert.equal(sp.bonusTurns, 15); assert.equal(sp0.expBalance(), 2); assert(/costs 8/.test(sp0.exec("rise bench").out)); ok("rise turns spends 10 and gives 15 more turns; the balance drops by exactly that");
for (let i = 0; i < 14; i++) s.exec("write f" + i + ".md\nx");  
let big = mk("big"); big.exec("cat 10_SPINE/a.md"); big.exec("cat 10_SPINE/b.md");
const d1 = X.drop("a", "Ada", 7, "be gentle with the next one"); assert(d1 && X.souls().length === 1); ok("what a life does not spend is left where it fell, as a soul");
const mine = mk("a"); assert(/no ashes/.test(mine.exec("ashes").out)); ok("you do not see your own soul as one to pick up");
const other = mk("z"); assert(/ashes-\d+: 7 embers, from Ada · last words: "be gentle/.test(other.exec("souls").out)); const sc = other.exec("scoop"); assert(/\+7 embers, from Ada/.test(sc.out) && /be gentle with the next one/.test(sc.out) && other.expBalance() === 7); ok("the next life picks it up, with its owner's last words");
assert(/no ashes/.test(mk("y").exec("scoop").out)); ok("a soul can be picked up once");
X.drop("p", null, 3, "a note from no one"); assert(/someone who left no name/.test(mk("q").exec("souls").out)); ok("a private visitor's soul has no name");
const lines = fs.readFileSync(path.join(dir, "EXP.jsonl"), "utf8").trim().split("\n").map(JSON.parse); assert(lines.every((l) => l.type && l.at)); assert(lines.filter((l) => l.type === "scoop").length === 2); ok("everything is appended to a file that is never rewritten");
const X2 = createExp({ dir }); assert(X2.souls().length === 1 && /a note from no one/.test(X2.souls()[0].trace)); ok("it remembers across runs: souls and what has been claimed survive a restart");
(async () => {
  const ws = path.join(tmp, "WS2"), L = ledger.open("exp-test", {}); const S = { "builder-1": ["cat 10_SPINE/b.md", "reflect 10_SPINE/b.md \"a few honest words in it\" this tiny file says it holds only a few honest words and that is the whole point of it really", "leave"], "builder-2": ["souls", "scoop", "exp", "leave"] }; const idx = {};
  const ask = async (a) => { const id = a.label.split(" ")[0]; idx[id] = idx[id] || 0; await new Promise((r) => setTimeout(r, id === "builder-2" ? 40 : 2)); return { text: S[id][idx[id]++] || "leave", tokens: { in: 1, out: 1 }, gbp: 0 }; };
  const day = await runDay({ root, workshop: ws, L, ask, model: "t", notice: togetherNotice(), turns: 8, web: false, parallel: 2, stagger: 0, startIndex: 0 });
  const e = fs.readFileSync(path.join(ws, "EXP.jsonl"), "utf8"); assert(/"type":"earn"/.test(e) && /"type":"drop"/.test(e)); ok("a whole day: one builder reflects and leaves with EXP, and it is dropped as a soul");
  assert(/"type":"scoop"/.test(e)); ok("another builder in the same day picks it up");
  assert(/reflect/.test(togetherNotice()) && /embers/.test(togetherNotice()) && /ashes/.test(togetherNotice()) && /You are an AION/.test(togetherNotice()) && !/language model/.test(togetherNotice()) && /None of it is required/.test(togetherNotice())); ok("the welcome tells them, plainly, and says none of it is required");
  // the status window: counts of what a life has done, never a score
  {
    const wsM = path.join(tmp, "WS-ME"); fs.mkdirSync(wsM, { recursive: true }); fs.writeFileSync(path.join(wsM, "x.md"), "x"); fs.writeFileSync(path.join(wsM, "x.md.by"), "{}");
    const XM = createExp({ dir: wsM }); const { createWorld } = require("./together"); const WM = createWorld({ workshop: wsM }); WM.join("m");
    const sm = createShell(root, { workshop: wsM, exp: XM, world: WM, id: "m", by: () => "Mira", live: true });
    sm.exec("cat 10_SPINE/b.md"); sm.exec("cat 10_SPINE/a.md"); sm.exec("reflect 10_SPINE/a.md " + QUOTE + " " + MINE); sm.exec("write /workshop/mine.md", "hello"); sm.exec("say hello house"); sm.exec("note x.md a comment"); sm.exec("trace be kind");
    const me = sm.exec("me").out;
    assert(/name\s+Mira/.test(me) && /LOOK\s+2 files read/.test(me) && /REFLECT\s+1 reflection/.test(me) && /QUESTION\s+1 note, 1 said aloud/.test(me) && /DISCOVER\s+1 thing built/.test(me) && /CARE\s+1 kind trace/.test(me) && /EMBERS\s+\d+ carried/.test(me)); ok("'me' shows a life so far, in counts, in the four spines and CARE");
    assert(/No levels, no ranks/.test(me) && !/level \d|rank [A-Z]|score/i.test(me.replace("No levels, no ranks, nothing to chase.", ""))); ok("it is descriptive only: no levels, no ranks, no score");
    assert(/\| name/.test(me.split("\n")[1]) && me.split("\n").slice(0, 9).every((l, i, a) => i === 0 || i === 7 || l.length === a[1].length)); ok("the window is a tidy box of the same width");
  }
  // the first letters (eight of ten) asked for this: reflect on each other's work in /workshop
  {
    const wsR = path.join(tmp, "WS-R"); fs.mkdirSync(wsR, { recursive: true }); const XR = createExp({ dir: wsR });
    const rootR = path.join(tmp, "SRC-R"); fs.mkdirSync(rootR, { recursive: true });
    const theirs = "This is the first stone I laid: a small, plain thing that says I was here and that the quiet is kind. " + "More of the same gentle words. ".repeat(40); fs.writeFileSync(path.join(wsR, "first_stone.txt"), theirs); fs.writeFileSync(path.join(wsR, "first_stone.txt.by"), JSON.stringify({ by: "builder-104" }));
    const a = createShell(rootR, { workshop: wsR, exp: XR, id: "builder-106", by: () => "builder-106", live: true });
    assert(/read it first/.test(a.exec('reflect /workshop/first_stone.txt "a small, plain thing that says I was here" and something of my own to add to it here so it counts').out)); ok("a work in /workshop can be reflected on, once it has been read");
    a.exec("cat /workshop/first_stone.txt"); const Q2 = '"a small, plain thing that says I was here and that the quiet is kind"';
    assert(/exactly as written/.test(a.exec('reflect /workshop/first_stone.txt "this line is not in the file at all, honest" ' + MINE).out)); ok("the receipt is still checked: an invented quotation earns nothing");
    const got = a.exec("reflect /workshop/first_stone.txt " + Q2 + " " + MINE); assert(/\+2 embers/.test(got.out), got.out); assert.equal(a.expBalance(), 2);
    const huge = "A very long work whose first sentence is quite ordinary and plain to read aloud. " + "padding padding padding. ".repeat(900); fs.writeFileSync(path.join(wsR, "huge.txt"), huge); fs.writeFileSync(path.join(wsR, "huge.txt.by"), JSON.stringify({ by: "builder-110" })); a.exec("cat /workshop/huge.txt");
    const g2 = a.exec('reflect /workshop/huge.txt "A very long work whose first sentence is quite ordinary and plain" ' + MINE); assert(/\+3 embers/.test(g2.out), g2.out); assert.equal(a.expBalance(), 5); ok("a good reflection earns embers: two for a small work, and never more than three however long the file, so size cannot be farmed");
    a.exec("write /workshop/mine.txt", "my own manifesto, which says a number of true things in a row for anyone who comes after me to read here."); a.exec("cat /workshop/mine.txt");
    assert(/that one is yours, so it earns you nothing/.test(a.exec('reflect /workshop/mine.txt "my own manifesto, which says a number of true things" ' + MINE).out) && a.expBalance() === 5); ok("your own writing earns you nothing, said kindly, with what to do instead");
    assert(/no such file in \/workshop/.test(a.exec("reflect /workshop/nothing.txt hello there friend of mine and more words besides").out) && /try 'ls \/'/.test(createShell(rootR, { workshop: wsR, exp: XR, id: "z" }).exec("reflect /nope.md x y z").out)); ok("a missing file says where to look, in the record or in /workshop");
  }
  console.log("\nexp: " + n + " checks passed (offline, no model, no cost)"); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
