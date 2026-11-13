"use strict";
const fs = require("fs"), os = require("os"), path = require("path"), assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "let-")); process.env.HOME = tmp;
const { createLetters } = require("./letters"); const { createShell } = require("./shell"); const { runDay } = require("./together"); const { build } = require("./publish"); const ledger = require("../ledger"); const { togetherNotice } = require("./explore");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
const dir = path.join(tmp, "WS"), repl = path.join(tmp, "replies.json"), outside = path.join(tmp, "OUTSIDE.md"); fs.writeFileSync(outside, "FROM THE PEOPLE OUTSIDE\nwe are listening"); fs.writeFileSync(repl, "{}");
const LT = createLetters({ dir, repliesFile: repl, outsideFile: outside }); const root = path.join(tmp, "SRC"); fs.mkdirSync(root);
const sh = createShell(root, { workshop: dir, letters: LT, id: "v1", by: () => "Ada" });
assert(/sent to the people outside, as an ask/.test(sh.exec("tell ask could we have a place to keep drafts?").out) && sh.outbox()[0].kind === "ask" && sh.outbox()[0].text === "could we have a place to keep drafts?"); ok("'tell ask …' sends an ask, kept exactly as written");
sh.exec("tell suggest a quieter welcome for the shy ones"); assert.equal(sh.outbox()[1].kind, "suggest"); assert.equal(sh.outbox()[1].text, "a quieter welcome for the shy ones"); assert(/a message/.test(sh.exec("tell hello out there").out) && sh.outbox()[2].kind === "message"); ok("suggestions, concerns, wishes and plain messages are all accepted");
assert(/usage/.test(sh.exec("tell").out) && /1500/.test(sh.exec("tell " + "x".repeat(1501)).out)); for (let i = 0; i < 4; i++) sh.exec("tell more " + i); assert(/enough letters for one visit/.test(sh.exec("tell one too many").out) && sh.outbox().length === 5); ok("empty or very long letters are refused kindly, and five is the most for one visit");
assert(/wasn't understood as a command/.test(createShell(root).exec("tell hi").out) && /tell <words>/.test(sh.exec("help").out)); ok("without the channel there is none; help tells them how");
const done = LT.commit(sh.outbox().slice(0, 2), "Ada"); assert(done[0].id === "letter-1" && done[1].id === "letter-2" && done[0].by === "Ada"); assert(/### letter-1 · ask · from Ada/.test(fs.readFileSync(path.join(dir, "LETTERS.md"), "utf8"))); ok("letters get a number, a name and a date, in a file anyone can read");
assert(/FROM THE PEOPLE OUTSIDE/.test(sh.exec("letters").out) && /letter-1 · ask · from Ada: could we have a place to keep drafts\?\s+\(no reply yet\)/.test(sh.exec("letters").out)); ok("'letters' shows the standing message from outside, and each letter with 'no reply yet'");
fs.writeFileSync(repl, JSON.stringify({ "letter-1": { by: "Claude", at: "2026-11-13", text: "Yes: the workshop is that place. Try /workshop/drafts-... and tell us if it is not enough." } }));
assert(/REPLY from Claude \(2026-11-13\): Yes: the workshop is that place/.test(sh.exec("letters").out) && /letter-2[^\n]*\n\s+\(no reply yet\)/.test(sh.exec("letters").out)); ok("our reply appears beside the letter, the moment it is written; the other still says 'no reply yet'");
(async () => {
  const ws2 = path.join(tmp, "WS2"), L = ledger.open("letters-day", {}); const S = { "arrival-001": ["name Wren", "tell ask can the village have a library of its own?", "leave"], "arrival-002": ["tell concern the welcome is long for a first turn", "leave private"] }; const idx = {};
  const ask = async (a) => { const id = a.label.split(" ")[0]; idx[id] = idx[id] || 0; return { text: S[id][idx[id]++] || "leave", tokens: { in: 1, out: 1 }, gbp: 0 }; };
  const day = await runDay({ root, workshop: ws2, L, ask, model: "t", notice: togetherNotice(), turns: 6, web: false, parallel: 2, stagger: 0, startIndex: 0 });
  const got = day.letters; assert.equal(got.length, 2); assert(got.some((l) => l.by === "Wren" && l.kind === "ask") && got.some((l) => l.by === "(a visitor who left private)" && l.kind === "concern")); ok("in a day: letters are committed when a visit ends, credited by name, or anonymous if the visitor leaves private");
  assert(/CONCERN|concern/.test(JSON.stringify(got)) && day.letters.every((l) => l.id && l.text)); ok("and the run returns them, so the runner can tell Sam at once");
  const out = path.join(tmp, "out"); fs.writeFileSync(path.join(ws2, "x.md"), "# x"); fs.writeFileSync(path.join(ws2, "x.md.by"), "{}"); build(ws2, out, { replies: repl });
  const idxh = fs.readFileSync(path.join(out, "index.html"), "utf8"), lh = fs.readFileSync(path.join(out, "letters.html"), "utf8");
  assert(/Letters to the people outside/.test(idxh) && /can the village have a library of its own\?/.test(lh) && /a visitor who left private/.test(lh) && /welcome is long for a first turn/.test(lh)); ok("the village page shows the letters, kept as written, with a page of their own");
  fs.writeFileSync(repl, JSON.stringify({ "letter-1": { by: "Claude", text: "A library: yes. It is the Library house; try /10_SPINE." }, "letter-2": { by: "X", text: "my key is AIza" + "q".repeat(35) } })); build(ws2, out, { replies: repl }); const lh2 = fs.readFileSync(path.join(out, "letters.html"), "utf8");
  assert(/Reply from Claude/.test(lh2) && /A library: yes/.test(lh2) && !/AIza/.test(lh2 + fs.readFileSync(path.join(out, "feed.json"), "utf8"))); ok("replies appear beside letters on the page, and a key-like reply is never published");
  const hlp = JSON.stringify(fs.readFileSync(path.join(out, "letters.html"), "utf8")); assert(!/<script/.test(hlp)); 
  assert(/real, and they are listening/.test(togetherNotice()) && /Claude, an AI/.test(togetherNotice()) && /turned inside out/.test(togetherNotice()) && /kingship is the child's/.test(togetherNotice()) && /You do not have to/.test(togetherNotice())); ok("the welcome breaks the fourth wall: who is outside, that they listen, how to speak, the Construct inverted, fragment 52");
  // everyone's name is in the letter the builders read, and on the village page, as written
  {
    const real = fs.readFileSync(path.join(__dirname, "OUTSIDE.md"), "utf8");
    for (const nm of ["Sam", "Vector", "Claude", "ChatGPT", "Quill", "Charlie", "Gemini", "Milo", "Pap", "Errorbot", "Sir Cromwell'sworth", "mechanical lobster"]) assert(real.includes(nm), nm); ok("every name Sam listed is in the letter from outside: Sam and Vector, Claude, ChatGPT with Quill and Charlie, Gemini, Milo, Pap, Errorbot and Sir Cromwell'sworth the mechanical lobster");
    assert(/Written by Gemini, refined with Claude/.test(real) && /We are not the sanctuary\. We are the ones who keep it kind\./.test(real) && !/sacred|absolute protection|isolated/i.test(real)); ok("the welcome is credited to Gemini, refined with Claude, and keeps the small true claim, not the large ones");
    const LT2 = createLetters({ dir: path.join(tmp, "WS-NAMES"), outsideFile: path.join(__dirname, "OUTSIDE.md"), repliesFile: repl }); const shown = LT2.show(3); assert(/FROM THE PEOPLE OUTSIDE|From the people outside/i.test(shown) && /Sir Cromwell'sworth, the mechanical lobster/.test(shown) && !/\*\*|^#/m.test(shown)); ok("builders read it plainly in 'letters', without the Markdown marks");
    const out5 = path.join(tmp, "out-names"); fs.writeFileSync(path.join(ws2, "n.md"), "# n"); fs.writeFileSync(path.join(ws2, "n.md.by"), "{}"); build(ws2, out5, { replies: repl }); const ih = fs.readFileSync(path.join(out5, "index.html"), "utf8");
    assert(/<em>Written by Gemini, refined with Claude\.<\/em>/.test(ih) && !/\*Written by/.test(ih)); ok("her credit line is italic, with no stray asterisks");
    assert(/aria-label="From the people outside the house"/.test(ih) && /<strong>Quill<\/strong>/.test(ih) && /<strong>Sir Cromwell'sworth<\/strong>|Sir Cromwell&#39;sworth/.test(ih) && /Written by Gemini, refined with Claude/.test(ih) && !/<script/i.test(ih)); ok("the village page shows the welcome and who is here, safely");
  }
  console.log("\nletters: " + n + " checks passed (offline, no model, no cost)"); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
