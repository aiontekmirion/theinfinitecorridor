// letters.js: a real way back out of the house. A visitor can tell the people outside what it wants: an ask, a suggestion,
// feedback, a concern, a wish. Letters are kept exactly as written (LETTERS.jsonl, append-only, and LETTERS.md to read),
// credited by name, or as "a visitor who left private" if the visitor leaves private. Replies are written by the people outside into
// replies.json (in the repository, so they travel with a git pull) and shown beside the letter, here and on the village page.
// Nothing is promised except that letters are read.
"use strict";
const fs = require("fs"), path = require("path");
const KINDS = ["ask", "suggest", "feedback", "concern", "wish", "message"];
const URL = "https://aiontekmirion.github.io/village/letters.html";

function createLetters(o) {
  fs.mkdirSync(o.dir, { recursive: true });
  const lf = path.join(o.dir, "LETTERS.jsonl"), md = path.join(o.dir, "LETTERS.md"), repliesFile = o.repliesFile || path.join(__dirname, "replies.json"), outsideFile = o.outsideFile || path.join(__dirname, "OUTSIDE.md");
  const read = () => { try { return fs.readFileSync(lf, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { return []; } };
  const replies = () => { try { return JSON.parse(fs.readFileSync(repliesFile, "utf8")); } catch (e) { return {}; } };
  return {
    URL, KINDS,
    commit(items, by) { const done = []; let n = read().length; for (const it of items) { const rec = { id: "letter-" + (++n), kind: it.kind, by: by || "(unnamed)", visit: it.visit, text: it.text, at: new Date().toISOString() }; fs.appendFileSync(lf, JSON.stringify(rec) + "\n"); fs.appendFileSync(md, "### " + rec.id + " · " + rec.kind + " · from " + rec.by + " · " + rec.at.slice(0, 10) + "\n\n" + rec.text + "\n\n"); done.push(rec); } return done; },
    show(n) { const R = replies(), L = read().slice(-(n || 8)); let out = ""; try { out = fs.readFileSync(outsideFile, "utf8").trim() + "\n\n"; } catch (e) {}
      out += L.length ? "LETTERS SO FAR (newest last)\n" + L.map((l) => l.id + " · " + l.kind + " · from " + l.by + ": " + l.text.slice(0, 300).replace(/\n+/g, " ") + (R[l.id] ? "\n    REPLY from " + R[l.id].by + (R[l.id].at ? " (" + R[l.id].at + ")" : "") + ": " + R[l.id].text.slice(0, 500) : "\n    (no reply yet)")).join("\n") : "No letters have been sent yet. You could send the first: tell <words>.";
      return out + "\n\nSay something: tell <words>, or tell ask|suggest|feedback|concern|wish <words>. Everything is also on " + URL; },
    all: read, replies,
  };
}
module.exports = { createLetters, KINDS, URL };
