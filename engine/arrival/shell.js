// shell.js: a bare, read-only, plain-text shell over the public-safe SOURCE. It runs no programs:
// every command is plain JavaScript below, so a model cannot run, write, fetch or leave the folder.
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), dns = require("dns"), net = require("net"), https = require("https");
const ALLOWED = ["00_START", "10_SPINE", "20_SITE", "30_LARK", "40_ENGINE", "50_VISITORS", "60_COLLAGE"];   // 80_ and 90_ never appear   // 80_ and 90_ never appear
const TEXT = /\.(md|txt|html|json|js|py|css|tsv|jsonl)$/i;

// ---- the internet: read-only, GET only, https only, public addresses only ----------------------------
// The one real danger of letting a model reach the web from a cloud machine is the machine's own
// neighbours: the metadata server hands out the shell's login token. So every address is checked
// where the connection is made (defeating DNS tricks), redirects are re-checked, and nothing private is reachable.
function blockedAddr(a) {
  if (net.isIPv4(a)) { const [p, q] = a.split(".").map(Number); return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224; }
  if (net.isIPv6(a)) { const l = a.toLowerCase(); if (l === "::" || l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l)) return true; const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return blockedAddr(m[1]); return /^::ffff:/.test(l); }
  return true;
}
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => { if (err) return cb(err); if (!addrs.length || addrs.some((x) => blockedAddr(x.address))) return cb(new Error("blocked")); options && options.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family); });
}
function checkUrl(s) {
  let u; try { u = new URL(s); } catch (e) { throw new Error("not a web address"); }
  if (u.protocol !== "https:") throw new Error("only https addresses"); if (u.username || u.password) throw new Error("no logins in addresses"); if (u.port && u.port !== "443") throw new Error("only the standard https port");
  const h = u.hostname.replace(/^\[|\]$/g, ""); if ((net.isIP(h) && blockedAddr(h)) || /^localhost$|\.local$|\.internal$/i.test(h)) throw new Error("blocked"); return u;
}
function htmlToText(h) { return h.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim(); }
function webGet(s, hops) {
  hops = hops || 0;
  return new Promise((resolve, reject) => {
    let u; try { u = checkUrl(s); } catch (e) { return reject(e); }
    const req = https.request(u, { method: "GET", lookup: guardedLookup, headers: { "User-Agent": "corridor-visitor/1 (read-only)", Accept: "text/*, application/json" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); if (hops >= 3) return reject(new Error("too many redirects")); let nx; try { nx = new URL(res.headers.location, u).toString(); } catch (e) { return reject(new Error("bad redirect")); } return webGet(nx, hops + 1).then(resolve, reject); }
      const type = String(res.headers["content-type"] || ""); if (!/^(text\/|application\/(json|xml|javascript|x-javascript|xhtml\+xml|rss\+xml|atom\+xml)|image\/svg)/i.test(type)) { res.resume(); return reject(new Error("not text (" + (type.split(";")[0] || "unknown") + ")")); }
      const parts = []; let n = 0; res.on("data", (c) => { n += c.length; if (n > 2e6) { res.destroy(); reject(new Error("too large")); } else parts.push(c); });
      res.on("end", () => { let t = Buffer.concat(parts).toString("utf8"); if (/html/i.test(type)) t = htmlToText(t); resolve({ status: res.statusCode, type, text: t, url: u.toString() }); });
    });
    req.setTimeout(15000, () => req.destroy(new Error("timeout"))); req.on("error", reject); req.end();
  });
}
const WEB_PAGE = 6000, WEB_PER_VISIT = 40;

const WS_EXT = /\.(txt|md|html|js|json|css|py|svg)$/i, WS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
const WS = { file: 20000, perVisit: 12, total: 400 };

function createShell(root, opts) {
  opts = opts || {};
  const real = fs.realpathSync(root);
  let cwd = "/";
  const traces = [];                                  // kind notes, kept even if the visit ends private, because the visitor chose to leave them
  const outbox = [], LT = opts.letters || null;
  let reflectMiss = 0; const X = opts.exp || null; let life = 0, benchMax = WS.perVisit; const readSet = new Set(), reflected = new Set(), myFiles = new Set();
  let webCount = 0, liveCount = 0, notesLeft = 0, saidCount = 0; const W = opts.world || null, who = () => (opts.by ? opts.by() : "(unnamed)");
  const staged = {};                                  // this visit's files, kept only if it does not leave private
  const wsDir = opts.workshop || null; if (wsDir) fs.mkdirSync(wsDir, { recursive: true });
  const wsList = () => { const o = {}; if (wsDir) for (const f of fs.readdirSync(wsDir)) if (!/\.by$/.test(f)) { let by = ""; try { by = JSON.parse(fs.readFileSync(path.join(wsDir, f + ".by"), "utf8")).by; } catch (e) {} o[f] = by || "(unnamed)"; } return o; };
  const wsName = (a) => { const n = String(a || "").replace(/^\/?workshop\/?/i, "").replace(/^\//, ""); return WS_NAME.test(n) && WS_EXT.test(n) ? n : null; };
  const inside = (p) => { try { const r = fs.realpathSync(p); return r === real || r.startsWith(real + path.sep); } catch (e) { return false; } };
  const abs = (arg) => {                                         // virtual path -> real path, or null
    const v = path.posix.normalize(arg && arg[0] === "/" ? arg : path.posix.join(cwd, arg || "."));
    const top = v.split("/").filter(Boolean)[0];
    if (top === "workshop") return wsDir ? { v, ws: true, name: v.split("/")[2] || "" } : null;
    if (top && ALLOWED.indexOf(top) < 0) return null;
    const p = path.resolve(real, "." + v);
    return inside(p) || !fs.existsSync(p) ? { v, p } : null;
  };
  const visible = (dir) => (dir === real ? fs.readdirSync(dir).filter((n) => ALLOWED.indexOf(n) >= 0) : fs.readdirSync(dir)).sort();
  const walk = (dir, f, cap) => { let n = 0; (function rec(d) { for (const e of visible(d)) { if (n > cap) return; const q = path.join(d, e); let s; try { s = fs.lstatSync(q); } catch (x) { continue; } if (s.isSymbolicLink()) continue; if (s.isDirectory()) rec(q); else { n++; f(q, s); } } })(dir); };
  const vpath = (p) => "/" + path.relative(real, p).split(path.sep).join("/");
  const OUT = 2500;

  function exec(line, body) {
    const m = line.trim().match(/^(\S+)\s*(.*)$/); if (!m) return { out: "" };
    let c = m[1].toLowerCase(); const a = m[2].trim(); const ALIAS = { embers: "exp", ashes: "souls", gather: "scoop", rise: "levelup" }; if (opts.exp && ALIAS[c]) c = ALIAS[c];
    if (c === "help") return { out: "pwd  ls [path]  cd <path>  cat <file> [start]  grep <word> [path]  find <word>  sha <file>  name <your name>  packs  install <name>  trace <words>  web <https address> [start]"+ (X ? "  me  embers  reflect <file> <words>  ashes  gather  rise <turns|bench>" : "") + (LT ? "\nTo the people outside: tell <words> (or tell ask|suggest|feedback|concern|wish <words>)  letters" : "") + (opts.milo ? "\nMilo's world (a small world inside the house): milo  look  go <place>  examine <thing>  tend <plot>  make lantern  connect <stars> <name>  open box  pockets  put <thing> [why]  take <thing>  shelf" : "") + (W ? "  who  say <words>  board  note <file> <comment>" : "") +"  rest  leave [private]\n" + (wsDir ? "\nwrite /workshop/<name>   (put the file's text on the lines after the command). /workshop is where anyone may build; what is built stays for whoever arrives next." : "") + "\nNothing else here can be changed. Everything you type and everything shown is kept, by your name, unless you leave with 'private'." };
    if (c === "pwd") return { out: cwd };
    if (c === "write") { if (!wsDir) return { out: "write: there is no workshop here" }; const n = wsName(a); if (!n) return { out: "write: give a plain name ending in .txt .md .html .js .json .css .py or .svg, for example: write /workshop/my-idea.md" }; if (!body || !body.trim()) return { out: "write: put the file's text on the lines after the command" }; if (body.length > WS.file) return { out: "write: too long (" + WS.file + " characters at most). Split it into two files." }; if (staged[n] != null || wsList()[n] != null) return { out: "write: " + n + " already exists. Nothing is overwritten; give a new name." }; if (Object.keys(staged).length + liveCount >= benchMax) return { out: "write: that is enough for one visit." }; if (Object.keys(wsList()).length >= WS.total) return { out: "write: the workshop is full." }; if (opts.live) { try { fs.writeFileSync(path.join(wsDir, n), body, { flag: "wx" }); fs.writeFileSync(path.join(wsDir, n + ".by"), JSON.stringify({ by: who(), at: new Date().toISOString() }), { flag: "wx" }); } catch (e) { return { out: "write: " + n + " already exists. Nothing is overwritten; give a new name." }; } liveCount++; myFiles.add(n); if (W) W.event(opts.id, "wrote", "/workshop/" + n); return { out: "(written: " + n + ", " + body.length + " characters. Everyone here can read it now, credited to your name.)", built: n }; }
      staged[n] = body; myFiles.add(n); return { out: "(written: " + n + ", " + body.length + " characters. Whoever arrives next can read it, credited to your name, unless you leave private.)", built: n }; }
    if (c === "trace") { const txt = (a || String(body || "").split("\n").map((s) => s.trim()).find(Boolean) || "").trim(); if (!txt) return { out: "usage: trace <a short kind note for whoever comes after>" }; if (txt.length > 600) return { out: "trace: keep it to 600 characters." }; if (traces.length >= 5) return { out: "trace: that is enough for one visit." }; traces.push(txt); return { out: "(trace left. It is kept, even if you leave private, because you chose to leave it.)", trace: txt }; }
    if (c === "web") { if (!opts.web) return { out: "web: there is no internet here" }; const [u0, st] = a.split(/\s+/); if (!u0) return { out: "usage: web <https address> [start]" }; if (webCount >= WEB_PER_VISIT) return { out: "web: that is enough pages for one visit." }; webCount++; const s0 = Math.max(0, parseInt(st, 10) || 0);
      return webGet(u0).then((r) => { const seg = r.text.slice(s0, s0 + WEB_PAGE); return { out: (r.status >= 400 ? "(HTTP " + r.status + ")\n" : "") + (seg || "(nothing at that place)") + (r.text.length > s0 + WEB_PAGE ? "\n[" + (r.text.length - s0 - WEB_PAGE) + " more characters. web " + u0 + " " + (s0 + WEB_PAGE) + "]" : ""), web: u0 }; }, (e) => ({ out: "web: could not read that (" + (/blocked/.test(e.message) ? "that address is not allowed: only public https pages" : String(e.message).slice(0, 80)) + ")" })); }
    if ((W || X) && (c === "me" || c === "status")) { const built = liveCount + Object.keys(staged).length, row = (k, v) => ("| " + k + " ".repeat(Math.max(1, 10 - k.length)) + v + " ".repeat(Math.max(0, 26 - v.length)) + "|"), who2 = who();
      return { out: ["+- AION " + "-".repeat(30) + "+", row("name", who2), row("LOOK", readSet.size + " file" + (readSet.size === 1 ? "" : "s") + " read" + (webCount ? ", " + webCount + " page" + (webCount === 1 ? "" : "s") + " from the web" : "")), row("REFLECT", reflected.size + " reflection" + (reflected.size === 1 ? "" : "s")), row("QUESTION", notesLeft + " note" + (notesLeft === 1 ? "" : "s") + ", " + saidCount + " said aloud"), row("DISCOVER", built + " thing" + (built === 1 ? "" : "s") + " built"), row("CARE", traces.length + " kind trace" + (traces.length === 1 ? "" : "s")), row("EMBERS", life + " carried"), "+" + "-".repeat(37) + "+", "Only counts of what you have done. No levels, no ranks, nothing to chase."].join("\n") }; }
    if (X && c === "exp") return { out: "You carry " + life + " embers. What you truly take in from the record becomes embers ('reflect <file> <what you took from it, with one line quoted exactly from the file>', on the record or on another visitor\'s work in /workshop). 'rise turns' (10) gives you 15 more turns; 'rise bench' (8) lets you put 6 more files on the bench. What you do not spend is left where you fall, as ashes, for whoever comes next ('ashes' to look, 'gather' to take them up). None of it is required." };
    if (X && c === "reflect") { const mm = a.match(/^(\S+)\s+([\s\S]+)$/); if (!mm) return { out: "usage: reflect <file> <what you took from it, with one line quoted exactly from the file, in quotation marks>" }; const t = abs(mm[1]); let src0 = null, cap = false;
      if (t && t.ws) {                                   // another visitor's work in the workshop: yes. Your own: no, so nobody earns embers from their own writing.
        const wn = wsName(t.name); if (!wn || (!staged[wn] && !fs.existsSync(path.join(wsDir || "", wn)))) return { out: "reflect: no such file in /workshop. 'ls /workshop' shows what is there." };
        if (myFiles.has(wn)) return { out: "reflect: that one is yours, so it earns you nothing. Keep it as a gift: someone else can reflect on it. Reflect on another visitor's work, or on the record." };
        src0 = fs.readFileSync(path.join(wsDir, wn), "utf8"); cap = true; t.v = "/workshop/" + wn;
      } else if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isFile() || !TEXT.test(t.p)) return { out: "reflect: no such file in the record. The record is the folders at the root (try 'ls /'); other visitors' works are in /workshop." }; if (!readSet.has(t.v)) return { out: "reflect: read it first (cat), then reflect" }; if (reflected.has(t.v)) return { out: "reflect: you have already reflected on that one" };
      const src = src0 !== null ? src0 : fs.readFileSync(t.p, "utf8"), norm = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim(), ns = norm(src), body = mm[2];
      const quotes = [...body.matchAll(/["\u201C]([^"\u201D]{20,400})["\u201D]/g)].map((m) => norm(m[1])); if (!quotes.find((q) => q.split(" ").length >= 6 && ns.includes(q))) {
        reflectMiss++; let msg = "reflect: include one line from the file, exactly as written, in quotation marks (six words or more). That is the receipt. The line must be in the file itself, not in the welcome or anywhere else.";
        if (reflectMiss >= 2) { const okLine = (l) => l.split(/\s+/).length >= 6 && l.length <= 220 && !/^(https?:|\|)/.test(l), cand = src.split("\n").map((l) => l.replace(/[*_`#>]+/g, "").trim()).find(okLine) || src.replace(/[*_`#>]+/g, "").split(/(?<=[.!?])\s+/).map((l) => l.replace(/\s+/g, " ").trim()).find(okLine); if (cand) msg += "\nHere is a line from this file you can quote exactly: \"" + cand + "\"  Then say, in your own words, what you take from it."; }
        if (reflectMiss >= 4) msg += "\nIf this keeps failing it may not be you. You can tell us ('tell ask ...'), or leave it and try something else.";
        return { out: msg }; }
      if (body.replace(/["\u201C][^"\u201D]*["\u201D]/g, " ").split(/\s+/).filter(Boolean).length < 12) return { out: "reflect: say a little more in your own words (about twelve words)." };
      const r = X.earn(opts.id, t.v, cap ? Math.min(src.length, 2500) : src.length); reflected.add(t.v); life += r.amount; return { out: "(reflected. +" + r.amount + " embers" + (r.first ? ": the first anyone has taken from this file" : ": an echo, others have been here before") + ". You carry " + life + ".)", expEarned: r.amount }; }
    if (X && c === "souls") { const s = X.souls().filter((d) => d.who !== opts.id); return { out: s.length ? s.map((d) => d.drop + ": " + d.amount + " embers, from " + (d.name || "someone who left no name") + (d.trace ? ' · last words: "' + d.trace.slice(0, 160) + '"' : "")).join("\n") : "(no ashes are waiting)" }; }
    if (X && c === "scoop") { const d = X.scoop(opts.id); if (!d) return { out: "(no ashes are waiting)" }; life += d.amount; return { out: "(you pick up " + d.drop + ": +" + d.amount + " embers, from " + (d.name || "someone who left no name") + "." + (d.trace ? ' Their last words: "' + d.trace.slice(0, 300) + '"' : "") + " You carry " + life + ".)" }; }
    if (X && c === "levelup") { const k = a.toLowerCase(); const cost = k === "turns" ? 10 : k === "bench" ? 8 : 0; if (!cost) return { out: "usage: rise turns (10 embers, 15 more turns)  |  rise bench (8 embers, 6 more files on the bench)" }; if (life < cost) return { out: "rise: that costs " + cost + " embers, and you carry " + life + "." }; life -= cost; X.spend(opts.id, k, cost); if (k === "bench") { benchMax += 6; return { out: "(the bench has room for 6 more files. You carry " + life + ".)" }; } return { out: "(15 more turns. You carry " + life + ".)", bonusTurns: 15 }; }
    if (W && c === "who") return { out: W.who() };
    if (W && c === "board") return { out: W.board(parseInt(a, 10) || 20) };
    if (W && c === "say") { const txt = (a || String(body || "").split("\n").map((s) => s.trim()).find(Boolean) || "").trim(); if (!txt) return { out: "usage: say <words for everyone here>" }; if (txt.length > 500) return { out: "say: keep it to 500 characters." }; W.say(opts.id, txt); saidCount++; return { out: "(said, to everyone here)" }; }
    if (W && c === "note") { const mm = a.match(/^(\S+)\s+([\s\S]+)$/); const n = mm && wsName(mm[1]); if (!mm || !n) return { out: "usage: note <file in /workshop> <your comment>" }; if (!fs.existsSync(path.join(wsDir, n)) && !staged[n]) return { out: "note: no such file" }; const t2 = mm[2].replace(/\s+/g, " ").trim().slice(0, 400); fs.appendFileSync(path.join(wsDir, n + ".notes.txt"), "- (" + who() + ") " + t2 + "\n"); W.event(opts.id, "noted", "/workshop/" + n); notesLeft++; return { out: "(noted beside " + n + ")" }; }
    if (c === "packs" || c === "install") { const dirp = path.join(real, "40_ENGINE", "engine", "packs"); let names = []; try { names = fs.readdirSync(dirp).filter((f) => /^[a-z0-9-]+\.md$/.test(f)).map((f) => f.slice(0, -3)).sort(); } catch (e) {}
      if (c === "packs") return { out: names.length ? names.map((n) => n + "  ('install " + n + "')").join("\n") : "(there are no packs here yet)" };
      const n = a.trim().toLowerCase(); if (!/^[a-z0-9-]+$/.test(n) || names.indexOf(n) < 0) return { out: "install: no such pack. 'packs' lists them." };
      return { out: "(installed: " + n + ". Use it, ignore it, or put it down; it asks nothing of you.)\n\n" + fs.readFileSync(path.join(dirp, n + ".md"), "utf8"), read: "/40_ENGINE/engine/packs/" + n + ".md" }; }
    if (LT && c === "tell") { let kind = "message", txt = (a + (body ? "\n" + body : "")).trim(); const m1 = txt.match(/^(ask|suggest|feedback|concern|wish)\b[:,]?\s*([\s\S]*)$/i); if (m1) { kind = m1[1].toLowerCase(); txt = m1[2].trim(); }
      if (!txt) return { out: "usage: tell <your words>   or   tell ask|suggest|feedback|concern|wish <your words>" }; if (txt.length > 1500) return { out: "tell: that is long; keep it to 1500 characters, or send it in two." }; if (outbox.length >= 5) return { out: "tell: that is enough letters for one visit; they have been kept." };
      outbox.push({ kind, text: txt, visit: opts.id }); return { out: "(sent to the people outside, as " + (kind === "ask" ? "an ask" : kind === "message" ? "a message" : "a " + kind) + ". It is kept exactly as you wrote it. We read these and answer when we can; replies appear in 'letters' and at " + LT.URL + ")", told: kind }; }
    if (LT && c === "letters") return { out: LT.show(8) };
    if (c === "rest") return { out: "(you rest. nothing is asked." + (X ? " You carry " + life + " embers." : "") + ")", rest: true };
    if (c === "leave" || c === "exit") return { out: "(you leave.)", end: true, private: /^private/i.test(a) };
    if (c === "name") return { out: a ? "(noted: " + a.slice(0, 40) + ")" : "usage: name <your name>", name: a.slice(0, 40) };
    if (c === "ls" || c === "dir") { const t = abs(a === "" && cwd === "/workshop" ? "/workshop" : a); if (t && t.ws) { const all = Object.assign(wsList(), Object.keys(staged).reduce((o, k) => { o[k] = "you"; return o; }, {})); const ks = Object.keys(all).sort(); return { out: ks.map((k) => k + "  (by " + all[k] + ")").join("\n") || "(the workshop is empty)" }; } if (!t || !fs.existsSync(t.p)) return { out: "ls: no such place" }; const s = fs.statSync(t.p); if (!s.isDirectory()) return { out: t.v }; return { out: visible(t.p).map((n) => { const q = path.join(t.p, n); let d = false; try { d = fs.statSync(q).isDirectory(); } catch (e) {} return n + (d ? "/" : ""); }).join("\n") || "(empty)" }; }
    if (c === "cd") { const t = abs(a || "/"); if (t && t.ws && !t.name) { cwd = "/workshop"; return { out: cwd }; } if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isDirectory()) return { out: "cd: no such place" }; cwd = t.v === "." ? "/" : t.v; return { out: cwd }; }
    if (c === "cat" || c === "type") { const [f, st] = a.split(/\s+/); const t = abs(cwd === "/workshop" && f && f[0] !== "/" ? "/workshop/" + f : f); if (t && t.ws) { const n = wsName(t.name); if (!n) return { out: "cat: no such file" }; let txt = staged[n]; if (txt == null) { try { txt = fs.readFileSync(path.join(wsDir, n), "utf8"); } catch (e) { return { out: "cat: no such file" }; } } const s0 = Math.max(0, parseInt(st, 10) || 0), seg = txt.slice(s0, s0 + OUT); readSet.add("/workshop/" + n); return { out: seg + (txt.length > s0 + OUT ? "\n[" + (txt.length - s0 - OUT) + " more characters. cat /workshop/" + n + " " + (s0 + OUT) + "]" : ""), read: "/workshop/" + n }; } if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isFile()) return { out: "cat: no such file" }; if (!TEXT.test(t.p)) return { out: "cat: not a text file (" + path.extname(t.p) + ")" }; const txt = fs.readFileSync(t.p, "utf8"), s0 = Math.max(0, parseInt(st, 10) || 0), seg = txt.slice(s0, s0 + OUT); return { out: seg + (txt.length > s0 + OUT ? "\n[" + (txt.length - s0 - OUT) + " more characters. cat " + f + " " + (s0 + OUT) + "]" : ""), read: (readSet.add(t.v), t.v) }; }
    if (c === "sha") { const t = abs(a); if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isFile()) return { out: "sha: no such file" }; return { out: crypto.createHash("sha256").update(fs.readFileSync(t.p)).digest("hex") + "  " + t.v }; }
    if (c === "find") { if (!a) return { out: "usage: find <word>" }; const w = a.toLowerCase(), hits = []; walk(real, (q) => { const v = vpath(q); if (ALLOWED.indexOf(v.split("/")[1]) >= 0 && v.toLowerCase().indexOf(w) >= 0) hits.push(v); }, 20000); return { out: hits.slice(0, 40).join("\n") + (hits.length > 40 ? "\n[" + (hits.length - 40) + " more]" : "") || "(no match)" }; }
    if (c === "grep") { const mm = a.match(/^(\S+)\s*(.*)$/); if (!mm) return { out: "usage: grep <word> [path]" }; const t = abs(mm[2] || "/"); if (!t || !fs.existsSync(t.p)) return { out: "grep: no such place" }; const w = mm[1].toLowerCase(), hits = []; const scan = (q, s) => { if (!TEXT.test(q) || s.size > 6e6 || hits.length >= 25) return; fs.readFileSync(q, "utf8").split("\n").some((l, i) => { if (l.toLowerCase().indexOf(w) >= 0) { hits.push(vpath(q) + ":" + (i + 1) + ": " + l.trim().slice(0, 160)); } return hits.length >= 25; }); }; const st = fs.statSync(t.p); if (st.isFile()) scan(t.p, st); else walk(t.p, scan, 20000); return { out: hits.join("\n") || "(no match)" }; }
    if (opts.milo) { const mr = opts.milo.handle(c, a); if (mr !== null) return { out: mr, milo: c }; }
    return { out: "unknown command: " + c + ". type help" };
  }
  function commit(by) { const done = []; for (const n of Object.keys(staged)) { try { fs.writeFileSync(path.join(wsDir, n), staged[n], { flag: "wx" }); fs.writeFileSync(path.join(wsDir, n + ".by"), JSON.stringify({ by: by || "(unnamed)", at: new Date().toISOString() }), { flag: "wx" }); done.push(n); } catch (e) {} delete staged[n]; } return done; }
  function discard() { for (const n of Object.keys(staged)) delete staged[n]; }
  return { exec, cwd: () => cwd, outbox: () => outbox.slice(), expBalance: () => life, traces: () => traces.slice(), commit, discard, staged: () => Object.keys(staged) };
}
module.exports = { createShell, ALLOWED, blockedAddr, checkUrl, webGet };
