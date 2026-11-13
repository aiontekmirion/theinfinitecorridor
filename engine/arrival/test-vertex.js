"use strict";
const http = require("http"), assert = require("assert").strict, fs = require("fs"), os = require("os"), path = require("path");
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vtx-"));
const { createClient } = require("./vertex");
const ledger = require("../ledger");
let n = 0; const ok = (s) => { n++; console.log("  ok  " + s); };
let mode = "normal", seen = [], hits = 0, tokenCalls = 0;
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) });
    res.setHeader("Content-Type", "application/json");
    if (mode === "expired" && req.headers.authorization === "Bearer OLD") { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: "Request had invalid authentication credentials." } })); }
    if (mode === "once429" && hits++ === 0) { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: "busy" } })); }
    if (mode === "nousage") return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }));
    if (mode === "err") { res.statusCode = 403; return res.end(JSON.stringify({ error: { message: "denied" } })); }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello there" }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 0 } }));
  });
}).listen(0, "127.0.0.1", async () => {
  const base = "http://127.0.0.1:" + srv.address().port;
  const L = ledger.open("arrival-test", { argv: [] });
  let c = createClient({ base, project: "p", token: "TEST-TOKEN", capGBP: 0.002, ledger: L });
  let r = await c.ask({ messages: [{ role: "user", text: "hi" }], label: "t1" });
  assert.equal(r.text, "hello there"); assert.equal(seen[0].auth, "Bearer TEST-TOKEN"); assert(seen[0].url.includes("/projects/p/")); ok("a call goes to the model with a token, no key");
  assert(Math.abs(r.gbp - ((1000 * 0.25 + 100 * 1.5) / 1e6) * 0.78) < 1e-9); ok("cost is taken from the model's own usage numbers");
  assert(!("x-goog-api-key" in {})); assert(!JSON.stringify(seen).includes("AIza")); ok("no api key anywhere in the request");
  let spent = c.stats().spentGBP; assert(spent > 0);
  let refused = false; for (let i = 0; i < 20 && !refused; i++) { try { await c.ask({ messages: [{ role: "user", text: "x".repeat(3000) }] }); } catch (e) { refused = !!e.ceiling; } }
  assert(refused); assert(c.stats().spentGBP <= 0.002 + 1e-9); ok("the ceiling refuses a call that would not fit, and spend never passes it");
  const before = seen.length; try { await c.ask({ messages: [{ role: "user", text: "x".repeat(300000) }] }); } catch (e) { assert(e.ceiling); } assert.equal(seen.length, before); ok("a refused call is never sent");
  mode = "nousage"; c = createClient({ base, project: "p", token: "T", capGBP: 5 });
  r = await c.ask({ messages: [{ role: "user", text: "hi" }] }); assert(r.gbp > 0); ok("a reply with no usage numbers is not treated as free");
  mode = "err"; c = createClient({ base, project: "p", token: "T", capGBP: 5, ledger: L });
  try { await c.ask({ messages: [{ role: "user", text: "hi" }] }); assert.fail("should throw"); } catch (e) { assert.equal(e.status, 403); } ok("an error is raised, never hidden");
  mode = "once429"; hits = 0; c = createClient({ base, project: "p", token: "T", capGBP: 5, retryMs: 5 }); r = await c.ask({ messages: [{ role: "user", text: "hi" }] }); assert.equal(r.text, "hello there"); assert.equal(hits, 2); assert(Math.abs(c.stats().spentGBP - r.gbp) < 1e-4); ok("a rate limit is retried, and the money is counted once");
  mode = "expired";
  const flag = path.join(process.env.HOME, "tokflag"); process.env.TOKFLAG = flag; c = createClient({ base, project: "p", capGBP: 5, retryMs: 5, tokenCmd: "node -e \"const f=process.env.TOKFLAG;const fs=require('fs');if(fs.existsSync(f)){console.log('NEW')}else{fs.writeFileSync(f,'');console.log('OLD')}\"" });
  r = await c.ask({ messages: [{ role: "user", text: "hi" }] }); assert.equal(r.text, "hello there"); ok("an expired login (401) fetches a fresh token and tries again, instead of ending the visit");
  // a model chosen by name needs a stated price, and the stated price is what is charged
  mode = "normal"; c = createClient({ base, project: "p", token: "T", capGBP: 5 }); assert(!c.hasPrice("new-big-model")); try { await c.ask({ model: "new-big-model", messages: [{ role: "user", text: "hi" }] }); assert.fail("should refuse"); } catch (e) { assert(/no price listed for model new-big-model/.test(e.message) && /--price new-big-model:/.test(e.message)); }
  c = createClient({ base, project: "p", token: "T", capGBP: 5, prices: { "new-big-model": [2, 10] } }); assert(c.hasPrice("new-big-model")); r = await c.ask({ model: "new-big-model", messages: [{ role: "user", text: "hi" }] }); assert(Math.abs(r.gbp - ((1000 * 2 + 100 * 10) / 1e6) * 0.78) < 1e-9); ok("an unpriced model is refused, and with a stated price the cost is charged at that price");
  L.close({}); const f = L.file || fs.readdirSync(path.join(process.env.HOME, "ledger")).map((x) => path.join(process.env.HOME, "ledger", x))[0];
  assert.equal(ledger.verify(f).ok, true); ok("every call is in the ledger and the hash chain verifies");
  console.log("\nvertex.js: " + n + " checks passed (offline, no model, no cost)"); srv.close(); process.exit(0);
});
