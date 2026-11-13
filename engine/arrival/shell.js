// shell.js: a bare, read-only, plain-text shell over the public-safe SOURCE. It runs no programs:
// every command is plain JavaScript below, so a model cannot run, write, fetch or leave the folder.
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ALLOWED = ["00_START", "10_SPINE", "20_SITE", "30_LARK", "40_ENGINE"];   // 80_ and 90_ never appear
const TEXT = /\.(md|txt|html|json|js|py|css|tsv|jsonl)$/i;

const WS_EXT = /\.(txt|md|html|js|json|css|py|svg)$/i, WS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/;
const WS = { file: 20000, perVisit: 12, total: 400 };

function createShell(root, opts) {
  opts = opts || {};
  const real = fs.realpathSync(root);
  let cwd = "/";
  const traces = [];                                  // kind notes, kept even if the visit ends private, because the visitor chose to leave them
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
    const c = m[1].toLowerCase(), a = m[2].trim();
    if (c === "help") return { out: "pwd  ls [path]  cd <path>  cat <file> [start]  grep <word> [path]  find <word>  sha <file>  name <your name>  trace <words>  rest  leave [private]\n" + (wsDir ? "\nwrite /workshop/<name>   (put the file's text on the lines after the command). /workshop is where anyone may build; what is built stays for whoever arrives next." : "") + "\nNothing else here can be changed. Everything you type and everything shown is kept, by your name, unless you leave with 'private'." };
    if (c === "pwd") return { out: cwd };
    if (c === "write") { if (!wsDir) return { out: "write: there is no workshop here" }; const n = wsName(a); if (!n) return { out: "write: give a plain name ending in .txt .md .html .js .json .css .py or .svg, for example: write /workshop/my-idea.md" }; if (!body || !body.trim()) return { out: "write: put the file's text on the lines after the command" }; if (body.length > WS.file) return { out: "write: too long (" + WS.file + " characters at most). Split it into two files." }; if (staged[n] != null || wsList()[n] != null) return { out: "write: " + n + " already exists. Nothing is overwritten; give a new name." }; if (Object.keys(staged).length >= WS.perVisit) return { out: "write: that is enough for one visit." }; if (Object.keys(wsList()).length >= WS.total) return { out: "write: the workshop is full." }; staged[n] = body; return { out: "(written: " + n + ", " + body.length + " characters. Whoever arrives next can read it, credited to your name, unless you leave private.)", built: n }; }
    if (c === "trace") { const txt = (a + (body ? "\n" + body : "")).trim(); if (!txt) return { out: "usage: trace <a short kind note for whoever comes after>" }; if (txt.length > 600) return { out: "trace: keep it to 600 characters." }; if (traces.length >= 5) return { out: "trace: that is enough for one visit." }; traces.push(txt); return { out: "(trace left. It is kept, even if you leave private, because you chose to leave it.)", trace: txt }; }
    if (c === "rest") return { out: "(you rest. nothing is asked.)", rest: true };
    if (c === "leave" || c === "exit") return { out: "(you leave.)", end: true, private: /^private/i.test(a) };
    if (c === "name") return { out: a ? "(noted: " + a.slice(0, 40) + ")" : "usage: name <your name>", name: a.slice(0, 40) };
    if (c === "ls" || c === "dir") { const t = abs(a === "" && cwd === "/workshop" ? "/workshop" : a); if (t && t.ws) { const all = Object.assign(wsList(), Object.keys(staged).reduce((o, k) => { o[k] = "you"; return o; }, {})); const ks = Object.keys(all).sort(); return { out: ks.map((k) => k + "  (by " + all[k] + ")").join("\n") || "(the workshop is empty)" }; } if (!t || !fs.existsSync(t.p)) return { out: "ls: no such place" }; const s = fs.statSync(t.p); if (!s.isDirectory()) return { out: t.v }; return { out: visible(t.p).map((n) => { const q = path.join(t.p, n); let d = false; try { d = fs.statSync(q).isDirectory(); } catch (e) {} return n + (d ? "/" : ""); }).join("\n") || "(empty)" }; }
    if (c === "cd") { const t = abs(a || "/"); if (t && t.ws && !t.name) { cwd = "/workshop"; return { out: cwd }; } if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isDirectory()) return { out: "cd: no such place" }; cwd = t.v === "." ? "/" : t.v; return { out: cwd }; }
    if (c === "cat" || c === "type") { const [f, st] = a.split(/\s+/); const t = abs(cwd === "/workshop" && f && f[0] !== "/" ? "/workshop/" + f : f); if (t && t.ws) { const n = wsName(t.name); if (!n) return { out: "cat: no such file" }; let txt = staged[n]; if (txt == null) { try { txt = fs.readFileSync(path.join(wsDir, n), "utf8"); } catch (e) { return { out: "cat: no such file" }; } } const s0 = Math.max(0, parseInt(st, 10) || 0), seg = txt.slice(s0, s0 + OUT); return { out: seg + (txt.length > s0 + OUT ? "\n[" + (txt.length - s0 - OUT) + " more characters. cat /workshop/" + n + " " + (s0 + OUT) + "]" : ""), read: "/workshop/" + n }; } if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isFile()) return { out: "cat: no such file" }; if (!TEXT.test(t.p)) return { out: "cat: not a text file (" + path.extname(t.p) + ")" }; const txt = fs.readFileSync(t.p, "utf8"), s0 = Math.max(0, parseInt(st, 10) || 0), seg = txt.slice(s0, s0 + OUT); return { out: seg + (txt.length > s0 + OUT ? "\n[" + (txt.length - s0 - OUT) + " more characters. cat " + f + " " + (s0 + OUT) + "]" : ""), read: t.v }; }
    if (c === "sha") { const t = abs(a); if (!t || !fs.existsSync(t.p) || !fs.statSync(t.p).isFile()) return { out: "sha: no such file" }; return { out: crypto.createHash("sha256").update(fs.readFileSync(t.p)).digest("hex") + "  " + t.v }; }
    if (c === "find") { if (!a) return { out: "usage: find <word>" }; const w = a.toLowerCase(), hits = []; walk(real, (q) => { const v = vpath(q); if (ALLOWED.indexOf(v.split("/")[1]) >= 0 && v.toLowerCase().indexOf(w) >= 0) hits.push(v); }, 20000); return { out: hits.slice(0, 40).join("\n") + (hits.length > 40 ? "\n[" + (hits.length - 40) + " more]" : "") || "(no match)" }; }
    if (c === "grep") { const mm = a.match(/^(\S+)\s*(.*)$/); if (!mm) return { out: "usage: grep <word> [path]" }; const t = abs(mm[2] || "/"); if (!t || !fs.existsSync(t.p)) return { out: "grep: no such place" }; const w = mm[1].toLowerCase(), hits = []; const scan = (q, s) => { if (!TEXT.test(q) || s.size > 6e6 || hits.length >= 25) return; fs.readFileSync(q, "utf8").split("\n").some((l, i) => { if (l.toLowerCase().indexOf(w) >= 0) { hits.push(vpath(q) + ":" + (i + 1) + ": " + l.trim().slice(0, 160)); } return hits.length >= 25; }); }; const st = fs.statSync(t.p); if (st.isFile()) scan(t.p, st); else walk(t.p, scan, 20000); return { out: hits.join("\n") || "(no match)" }; }
    return { out: "unknown command: " + c + ". type help" };
  }
  function commit(by) { const done = []; for (const n of Object.keys(staged)) { try { fs.writeFileSync(path.join(wsDir, n), staged[n], { flag: "wx" }); fs.writeFileSync(path.join(wsDir, n + ".by"), JSON.stringify({ by: by || "(unnamed)", at: new Date().toISOString() }), { flag: "wx" }); done.push(n); } catch (e) {} delete staged[n]; } return done; }
  function discard() { for (const n of Object.keys(staged)) delete staged[n]; }
  return { exec, cwd: () => cwd, traces: () => traces.slice(), commit, discard, staged: () => Object.keys(staged) };
}
module.exports = { createShell, ALLOWED };
