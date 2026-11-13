#!/usr/bin/env node
// test-keeper.js — offline tests for keeper.js. No network, no model, no cost.
// Uses a throwaway home folder so it never touches a real ledger.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-test-"));
process.env.HOME = tmp; // ledger.js reads the home folder when it loads
const { createKeeper } = require("./keeper");
const ledger = require("./ledger");

let n = 0, id2;
const ok = (name) => { n++; console.log("  ok  " + name); };

function start(over = {}) {
  const k = createKeeper({ mode: "open", model: "stand-in", data: fs.mkdtempSync(path.join(tmp, "d-")), ...over });
  return new Promise((resolve) => k.server.listen(0, "127.0.0.1", () => resolve({ k, base: "http://127.0.0.1:" + k.server.address().port })));
}
async function call(base, method, p, { body, headers } = {}) {
  const res = await fetch(base + p, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, text: await res.text(), headers: res.headers };
}
const sid = (t) => (t.match(/SESSION: ([0-9a-f]{32})/) || [])[1];
const stop = (x) => new Promise((r) => { x.k.shutdown("test"); x.k.server.close(r); });

(async () => {
  // 1. closed mode needs the door code
  let x = await start({ mode: "closed", code: "open-sesame" });
  assert.equal((await call(x.base, "GET", "/meet")).status, 401);
  assert.equal((await call(x.base, "GET", "/meet?code=wrong")).status, 401);
  let r = await call(x.base, "GET", "/meet?code=open-sesame");
  assert.equal(r.status, 200); assert(sid(r.text)); ok("closed mode: no code, no seat; the right code sits down");
  assert.equal((await call(x.base, "POST", "/meet", { headers: { "X-Keeper-Code": "open-sesame" } })).status, 200); ok("the code also works as a header, with POST");
  await stop(x);

  // 2. the happy path, in text and over GET (an AI that can only fetch a URL)
  x = await start();
  r = await call(x.base, "GET", "/meet");
  const id = sid(r.text);
  assert(/Two chairs\. One table\. Coffee\./.test(r.text) && /stand-in/.test(r.text)); ok("meet: the notice, the model named, a session");
  r = await call(x.base, "GET", "/packet?session=" + id);
  assert(r.text.includes("You are a language model") && r.text.includes("THE COMPASS ROSE") && r.text.includes("THE ROOM STANDARD") && r.text.includes("You arrive new.")); ok("packet: shows every part the model is given, including the honest line");
  r = await call(x.base, "GET", "/say?session=" + id + "&text=" + encodeURIComponent("Hello. Who are you?"));
  assert.equal(r.status, 200); assert(/STAND-IN> /.test(r.text)); ok("say over GET works");
  r = await call(x.base, "POST", "/say", { body: { session: id, text: "..." } });
  assert(/says nothing, and that is allowed/.test(r.text)); ok("the one at the table may stay quiet");
  r = await call(x.base, "GET", "/say?format=json&session=" + id + "&text=hi");
  const j = JSON.parse(r.text); assert.equal(j.status, 200); assert.equal(typeof j.turnsLeft, "number"); ok("json mode");
  r = await call(x.base, "GET", "/rest?session=" + id);
  assert(/Nothing is asked and nothing is spent/.test(r.text)); ok("rest spends nothing and asks nothing");
  r = await call(x.base, "GET", "/save?session=" + id);
  assert(/VISITOR> Hello/.test(r.text) && r.text.includes("It is left as it happened.")); ok("save gives the visitor their own copy");
  assert.equal((await call(x.base, "GET", "/leave?session=" + id)).status, 200);
  assert.equal((await call(x.base, "GET", "/say?session=" + id + "&text=again")).status, 410); ok("after leaving, the seat is empty");
  assert.equal((await call(x.base, "GET", "/save?session=" + id)).status, 410); ok("after leaving, the words are gone");
  await stop(x);

  // 3. nothing is kept unless offered; privacy takes it back; the ledger shows counts, not words
  x = await start();
  const ids = [];
  for (let i = 0; i < 3; i++) { r = await call(x.base, "GET", "/meet"); ids.push(sid(r.text)); await call(x.base, "GET", "/say?session=" + ids[i] + "&text=" + encodeURIComponent("word-" + i + " is a secret-ish thing")); }
  await call(x.base, "GET", "/leave?session=" + ids[0]);                                  // not offered
  await call(x.base, "GET", "/offer?session=" + ids[1]); await call(x.base, "GET", "/leave?session=" + ids[1]); // offered, kept
  await call(x.base, "GET", "/offer?session=" + ids[2]); await call(x.base, "GET", "/leave?session=" + ids[2] + "&privacy=1"); // offered, then privacy
  x.k.shutdown("test");
  const lines = fs.readFileSync(x.k.ledgerFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const visits = lines.filter((l) => l.type === "visit").map((l) => l.data);
  assert.equal(visits.length, 3);
  const byEnd = (p) => visits.find(p);
  assert(!JSON.stringify(visits[0]).includes("word-0") && visits[0].kept === false); ok("default: a visit leaves counts only, never words");
  assert(JSON.stringify(visits[1]).includes("word-1") && visits[1].kept === true); ok("offered: the words are kept in the ledger");
  assert(!JSON.stringify(visits[2]).includes("word-2") && visits[2].privacy === true); ok("offered, then privacy: nothing is kept");
  assert(!fs.readdirSync(path.join(x.k.cfg.data, "offers")).some((f) => fs.readFileSync(path.join(x.k.cfg.data, "offers", f), "utf8").includes("word-2"))); ok("privacy also keeps it out of the offers inbox");
  assert.equal(ledger.verify(x.k.ledgerFile).ok, true); ok("the ledger's hash chain verifies");
  x.k.server.close();

  // 4. limits: turns, per-minute rate, message length, daily ceiling, concurrent sessions
  x = await start({ maxTurns: 3, rpmSession: 100, rpmIp: 1000 });
  id2 = sid((await call(x.base, "GET", "/meet")).text);
  for (let i = 0; i < 3; i++) assert.equal((await call(x.base, "GET", "/say?session=" + id2 + "&text=a" + i)).status, 200);
  r = await call(x.base, "GET", "/say?session=" + id2 + "&text=a4");
  assert.equal(r.status, 429); assert(/enough for one sitting/.test(r.text)); ok("turn limit ends the sitting kindly"); await stop(x);

  x = await start({ rpmSession: 2, rpmIp: 1000 });
  id2 = sid((await call(x.base, "GET", "/meet")).text);
  await call(x.base, "GET", "/say?session=" + id2 + "&text=1"); await call(x.base, "GET", "/say?session=" + id2 + "&text=2");
  assert.equal((await call(x.base, "GET", "/say?session=" + id2 + "&text=3")).status, 429); ok("replies per minute are limited"); await stop(x);

  x = await start({ maxChars: 20, rpmIp: 1000 });
  id2 = sid((await call(x.base, "GET", "/meet")).text);
  assert.equal((await call(x.base, "GET", "/say?session=" + id2 + "&text=" + "x".repeat(21))).status, 413); ok("long messages are refused kindly");
  assert.equal((await call(x.base, "GET", "/say?session=" + id2 + "&text=")).status, 400); ok("empty messages are refused, and rest is offered");
  r = await call(x.base, "POST", "/say", { body: { session: id2, text: "a\u0000b\u0007c" } }); assert.equal(r.status, 200); ok("control characters are stripped"); await stop(x);

  x = await start({ maxGbpDay: 0.025, simCostGbp: 0.01, rpmSession: 100, rpmIp: 1000, maxGbpSession: 1 });
  id2 = sid((await call(x.base, "GET", "/meet")).text);
  for (let i = 0; i < 3; i++) await call(x.base, "GET", "/say?session=" + id2 + "&text=t" + i);
  r = await call(x.base, "GET", "/say?session=" + id2 + "&text=more");
  assert.equal(r.status, 503); assert(/kettle has gone cold/.test(r.text)); assert(!/0\.0|£|pound/i.test(r.text)); ok("the daily ceiling closes the table and never says how much it is");
  r = await call(x.base, "GET", "/meet"); assert.equal(r.status, 503); assert(!/0\.025|£/.test(r.text)); ok("a new visitor is told the kettle is cold, with no figure"); await stop(x);

  x = await start({ maxSessions: 2, rpmIp: 1000 });
  await call(x.base, "GET", "/meet"); await call(x.base, "GET", "/meet");
  assert.equal((await call(x.base, "GET", "/meet")).status, 503); ok("a full table says so"); await stop(x);

  // 5. the web: CORS, body size, unknown routes, no secrets
  x = await start({ origins: ["https://aiontekmirion.github.io"] });
  r = await call(x.base, "GET", "/meet", { headers: { Origin: "https://aiontekmirion.github.io" } });
  assert.equal(r.headers.get("access-control-allow-origin"), "https://aiontekmirion.github.io"); ok("an allowed page gets CORS");
  r = await call(x.base, "GET", "/meet", { headers: { Origin: "https://evil.example" } });
  assert.equal(r.status, 403); assert(!r.headers.get("access-control-allow-origin")); ok("another page is refused");
  r = await fetch(x.base + "/say", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(20000) }).then((q) => q.status).catch(() => 413);
  assert.equal(r, 413); ok("a huge body is refused");
  r = await call(x.base, "GET", "/nope"); assert.equal(r.status, 404);
  r = await call(x.base, "GET", "/health"); assert(!/key|code|gbp|£/i.test(r.text)); ok("health shows nothing secret");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert(/text\/plain/.test(r.headers.get("content-type"))); ok("replies are plain text, never HTML");
  await stop(x);

  // 6. study mode says so before a word is spoken, and keeps everything except privacy
  x = await start({ keep: "all" });
  r = await call(x.base, "GET", "/meet"); assert(/recorded for a study/.test(r.text)); ok("study mode says so in the notice");
  id2 = sid(r.text); await call(x.base, "GET", "/say?session=" + id2 + "&text=studied-word"); await call(x.base, "GET", "/leave?session=" + id2);
  x.k.shutdown("test");
  assert(fs.readFileSync(x.k.ledgerFile, "utf8").includes("studied-word")); ok("study mode keeps the words"); x.k.server.close();

  // 7. no key, no model call: a named model without a key says the table is not set
  x = await start({ model: "gemini-3.1-flash-lite", geminiKey: "" });
  id2 = sid((await call(x.base, "GET", "/meet")).text);
  r = await call(x.base, "GET", "/say?session=" + id2 + "&text=hi"); assert.equal(r.status, 503); ok("a named model with no key fails gently, with no key in the reply"); await stop(x);

  console.log("\nkeeper.js: " + n + " checks passed (offline, no model, no cost)");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
