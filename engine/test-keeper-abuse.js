#!/usr/bin/env node
// test-keeper-abuse.js — the keeper, attacked. Offline: no network, no model, no cost.
// Each check is a way someone (or something) might misuse or break the table. Run after test-keeper.js.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const assert = require("assert").strict;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-abuse-"));
process.env.HOME = tmp;
const { createKeeper } = require("./keeper");

let n = 0;
const ok = (name) => { n++; console.log("  ok  " + name); };
const realFetch = global.fetch;
let geminiCalls = [];
let geminiMode = "ok"; // ok | nousage | 429 | 400thinking | long
global.fetch = async (url, opts) => {
  if (!String(url).includes("generativelanguage.googleapis.com")) return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  geminiCalls.push({ url: String(url), headers: opts.headers, body });
  const reply = (text, usage) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], ...(usage === null ? {} : { usageMetadata: usage || { promptTokenCount: 900, candidatesTokenCount: 40, thoughtsTokenCount: 10 } }) }) });
  if (geminiMode === "429") return { ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "quota" } }) };
  if (geminiMode === "400thinking" && body.generationConfig.thinkingConfig) return { ok: false, status: 400, json: async () => ({ error: { message: "thinking not supported" } }) };
  if (geminiMode === "nousage") return reply("A reply with no usage report.", null);
  if (geminiMode === "long") return reply("x".repeat(20000) + "\u0000\u0007<script>alert(1)</script>");
  return reply("I am a model at the table.");
};

function start(over = {}) {
  const k = createKeeper({ mode: "open", model: "stand-in", data: fs.mkdtempSync(path.join(tmp, "d-")), rpmIp: 10000, rpmSession: 10000, ...over });
  return new Promise((resolve) => k.server.listen(0, "127.0.0.1", () => resolve({ k, base: "http://127.0.0.1:" + k.server.address().port })));
}
async function call(base, method, p, { body, headers } = {}) {
  const res = await realFetch(base + p, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, text: await res.text(), headers: res.headers };
}
const sid = (t) => (t.match(/SESSION: ([0-9a-f]{32})/) || [])[1];
const stop = (x) => new Promise((r) => { x.k.shutdown("test"); x.k.server.close(r); });
const raw = (port, rawPath) => new Promise((resolve, reject) => { const q = http.request({ host: "127.0.0.1", port, path: rawPath, method: "GET" }, (res) => { let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, text: d })); }); q.on("error", reject); q.end(); });

(async () => {
  let x, r;

  // 1. a crawler or one place cannot fill the table
  x = await start({ maxPerIp: 2, maxSessions: 20, ipHeader: "x-test-ip" });
  const mine = { "x-test-ip": "10.0.0.1" };
  assert.equal((await call(x.base, "GET", "/meet", { headers: mine })).status, 200);
  assert.equal((await call(x.base, "GET", "/meet", { headers: mine })).status, 200);
  r = await call(x.base, "GET", "/meet", { headers: mine }); assert.equal(r.status, 429); assert(/already have a seat/.test(r.text)); ok("one address can hold only a couple of seats");
  assert.equal((await call(x.base, "GET", "/meet", { headers: { "x-test-ip": "10.0.0.2" } })).status, 200); ok("another address still gets one, so a crawler cannot lock everyone out");
  await stop(x);

  // 2. a spoofed X-Forwarded-For does not buy a new allowance
  x = await start({ rpmIp: 3 });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call(x.base, "GET", "/meet", { headers: { "X-Forwarded-For": "1.2.3." + i } })).status);
  assert(codes.includes(429)); ok("X-Forwarded-For is ignored unless a trusted header is configured");
  await stop(x);

  // 3. a seat nobody used is given back
  x = await start({ emptyMin: 0.001, idleMin: 20 });
  const idle = sid((await call(x.base, "GET", "/meet")).text);
  await new Promise((r2) => setTimeout(r2, 120)); x.k.sweepNow();
  assert.equal((await call(x.base, "GET", "/say?session=" + idle + "&text=hi")).status, 410); ok("an unused seat expires quickly");
  const used = sid((await call(x.base, "GET", "/meet")).text);
  await call(x.base, "GET", "/say?session=" + used + "&text=hi"); await new Promise((r2) => setTimeout(r2, 120)); x.k.sweepNow();
  assert.equal((await call(x.base, "GET", "/say?session=" + used + "&text=again")).status, 200); ok("a seat that has been used is not taken away early");
  await stop(x);

  // 4. guessing the door code locks the guesser out, even for the right code
  x = await start({ mode: "closed", code: "correct-horse-battery-staple", failLimit: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await call(x.base, "GET", "/meet?code=guess" + i)).status, 401);
  r = await call(x.base, "GET", "/meet?code=correct-horse-battery-staple"); assert.equal(r.status, 429); ok("repeated wrong door codes lock the guesser out for a while");
  await stop(x);

  // 5. a burst cannot all slip past the daily ceiling
  x = await start({ maxGbpDay: 0.015, simCostGbp: 0.01, maxGbpSession: 1, maxPerIp: 50, maxSessions: 50, ipHeader: "x-test-ip" });
  const seats = [];
  for (let i = 0; i < 10; i++) seats.push(sid((await call(x.base, "GET", "/meet", { headers: { "x-test-ip": "9.9.9." + i } })).text));
  const results = await Promise.all(seats.map((id, i) => call(x.base, "GET", "/say?session=" + id + "&text=burst", { headers: { "x-test-ip": "9.9.9." + i } })));
  const passed = results.filter((q) => q.status === 200).length;
  assert(passed <= 2, "passed: " + passed); ok("ten replies at once: at most " + passed + " passed a ceiling that allows about one");
  await stop(x);

  // 6. visiting a page or a link spends nothing
  x = await start({ simCostGbp: 0.01 });
  await call(x.base, "GET", "/meet"); await call(x.base, "GET", "/"); await call(x.base, "GET", "/health"); await call(x.base, "GET", "/robots.txt");
  assert.equal(x.k.state().gbp, 0); ok("meet, health and the front page spend nothing");
  r = await call(x.base, "GET", "/robots.txt"); assert(/Disallow: \//.test(r.text)); ok("robots.txt tells crawlers to stay away");
  r = await call(x.base, "GET", "/meet"); assert(/default-src 'none'/.test(r.headers.get("content-security-policy")) && r.headers.get("referrer-policy") === "no-referrer" && /noindex/.test(r.headers.get("x-robots-tag"))); ok("replies carry a strict content policy, no referrer, noindex");
  await stop(x);

  // 7. odd input does not break it
  x = await start({ maxChars: 1500 });
  const o = sid((await call(x.base, "GET", "/meet")).text);
  assert.equal((await call(x.base, "POST", "/say", { body: { session: o, text: ["a", "b"] } })).status, 200); ok("an array where text should be is coerced, not crashed on");
  assert.equal((await call(x.base, "POST", "/say", { body: { session: { a: 1 }, text: "hi" } })).status, 404); ok("an object where the session should be is just not a session");
  assert.equal((await call(x.base, "POST", "/say", { body: { session: o, text: "😀 مرحبا ‮ text" } })).status, 200); ok("emoji and right-to-left text are fine");
  assert.equal((await raw(x.k.server.address().port, "/say?session=" + o + "&text=%E0%A4%A")).status < 500, true); ok("a broken percent-escape does not crash it");
  assert.equal((await call(x.base, "PUT", "/say")).status, 405); assert.equal((await call(x.base, "DELETE", "/meet")).status, 405); ok("other methods are refused");
  assert.equal((await call(x.base, "GET", "/say?session=" + o + "&text=" + "x".repeat(2000))).status, 413); ok("a long query is refused kindly");
  await stop(x);

  // 8. the model adapter, with a fake Google
  geminiCalls = []; geminiMode = "ok";
  x = await start({ model: "gemini-3.1-flash-lite", geminiKey: "TESTKEY-do-not-leak-123" });
  const g = sid((await call(x.base, "GET", "/meet")).text);
  r = await call(x.base, "GET", "/say?session=" + g + "&text=" + encodeURIComponent("Hello there"));
  assert.equal(r.status, 200); assert(/I am a model at the table\./.test(r.text)); ok("a model reply comes back as text");
  const c = geminiCalls[0];
  assert(c.headers["x-goog-api-key"] === "TESTKEY-do-not-leak-123" && !c.url.includes("TESTKEY")); ok("the key goes in a header, never in the address");
  assert(c.body.systemInstruction.parts[0].text.includes("You are a language model") && c.body.systemInstruction.parts[0].text.includes("THE ROOM STANDARD")); ok("the model is given the packet, and the visitor can PACKET to see the same words");
  assert.equal(c.body.contents[0].role, "user"); assert(!JSON.stringify(c.body).includes("TESTKEY")); ok("nothing in the request body carries the key");
  r = await call(x.base, "GET", "/packet?session=" + g); assert.equal(r.text.includes("TESTKEY"), false);
  for (const q of ["/meet", "/health", "/say?session=" + g + "&text=again", "/packet?session=" + g, "/save?session=" + g]) assert(!(await call(x.base, "GET", q)).text.includes("TESTKEY")); ok("the key never appears in any reply");
  assert(x.k.state().gbp > 0); ok("a model reply is counted against the day");
  geminiMode = "nousage"; const before = x.k.state().gbp;
  await call(x.base, "GET", "/say?session=" + g + "&text=more"); assert(x.k.state().gbp > before); ok("a model that reports no usage is estimated, never counted as free");
  geminiMode = "429"; r = await call(x.base, "GET", "/say?session=" + g + "&text=quota"); assert.equal(r.status, 503); assert(/kettle has gone cold/.test(r.text) && !/quota|429|RESOURCE/.test(r.text)); ok("a model that is over quota fails gently, with no detail");
  geminiMode = "400thinking"; r = await call(x.base, "GET", "/say?session=" + g + "&text=think"); assert.equal(r.status, 200); ok("a model that rejects a setting is retried without it");
  geminiMode = "long"; r = await call(x.base, "GET", "/say?session=" + g + "&text=long");
  assert(r.text.length < 6200 && !/\u0000|\u0007/.test(r.text)); ok("a very long reply is cut and cleaned");
  await stop(x);

  // 9. the closed trial: the door code, and nothing on the model's side without it
  geminiCalls = []; geminiMode = "ok";
  x = await start({ mode: "closed", code: "a-long-door-code-1234", model: "gemini-3.1-flash-lite", geminiKey: "K" });
  await call(x.base, "GET", "/meet"); assert.equal(geminiCalls.length, 0); ok("without the door code, no model call is ever made");
  await stop(x);

  global.fetch = realFetch;
  console.log("\nkeeper.js, attacked: " + n + " checks passed (offline, no model, no cost)");
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e); process.exit(1); });
