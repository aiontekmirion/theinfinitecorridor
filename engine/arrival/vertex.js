#!/usr/bin/env node
// vertex.js: a model client with a hard money ceiling. No API key: it takes a short-lived
// token from the signed-in Cloud Shell (gcloud) at call time and stores nothing.
//
// Money rule: before every call the worst-case cost is RESERVED against the cap; the call is
// refused if it would not fit. After the call the reservation is replaced by the cost reported
// by the model's own usage numbers. Every call goes into the append-only ledger.
// Prices are list prices in USD per million tokens, kept in ONE table so Sam can see and change them.
"use strict";
const { execSync } = require("child_process");
const https = require("https"), http = require("http");

const PRICES = {                       // [input, output] USD per 1M tokens. List prices, to be checked.
  "gemini-3.1-flash-lite": [0.25, 1.50],
  "gemini-3.1-flash-lite-preview": [0.50, 3.00],
};
const USD_TO_GBP = 0.78;

function createClient(opts) {
  const o = Object.assign({
    capGBP: 26, project: process.env.GOOGLE_CLOUD_PROJECT || "",
    base: "https://aiplatform.googleapis.com",
    tokenCmd: "gcloud auth print-access-token",
    ledger: null, maxOutputTokens: 1024, charsPerToken: 3.5, retryMs: 2500,
  }, opts || {});
  let spent = 0, reserved = 0, calls = 0, refused = 0, tokenCache = { t: "", at: 0 };

  const token = () => {                // refreshed every 30 minutes, never written anywhere
    if (o.token) return o.token;
    if (!tokenCache.t || Date.now() - tokenCache.at > 30 * 60 * 1000) tokenCache = { t: execSync(o.tokenCmd, { encoding: "utf8" }).trim(), at: Date.now() };
    return tokenCache.t;
  };
  const price = (m) => { const p = PRICES[m]; if (!p) throw new Error("no price listed for model " + m); return p; };
  const gbp = (m, tin, tout) => ((tin * price(m)[0] + tout * price(m)[1]) / 1e6) * USD_TO_GBP;

  function post(url, body, headers) {
    return new Promise((resolve, reject) => {
      const u = new URL(url), mod = u.protocol === "http:" ? http : https;
      const req = mod.request(u, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers) }, (res) => {
        let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, text: d }));
      });
      req.on("error", reject); req.setTimeout(120000, () => req.destroy(new Error("timeout"))); req.end(JSON.stringify(body));
    });
  }

  // ask({ model, system, messages:[{role,text}], temperature, label }) -> { text, tokens:{in,out}, gbp }
  async function ask(a) {
    const model = a.model || "gemini-3.1-flash-lite";
    const maxOut = a.maxOutputTokens || o.maxOutputTokens;
    const chars = (a.system || "").length + a.messages.reduce((n, m) => n + m.text.length, 0);
    const worst = gbp(model, Math.ceil(chars / o.charsPerToken) + 50, maxOut);
    if (spent + reserved + worst > o.capGBP) { refused++; const e = new Error("ceiling"); e.ceiling = true; throw e; }
    reserved += worst;
    let r;
    try {
      const body = {
        contents: a.messages.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text }] })),
        generationConfig: { maxOutputTokens: maxOut, temperature: a.temperature == null ? 1 : a.temperature, thinkingConfig: { thinkingBudget: 0 } },
      };
      if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };
      const url = o.base + "/v1/projects/" + o.project + "/locations/global/publishers/google/models/" + model + ":generateContent";
      const go = () => post(url, body, { Authorization: "Bearer " + token() });
      for (let attempt = 0; ; attempt++) {          // rate limits and busy servers are retried, a few times, with a pause; the money is counted once
        try { r = await go(); } catch (e) { if (attempt >= 2) throw e; await new Promise((z) => setTimeout(z, o.retryMs * (attempt + 1))); continue; }
        if (r.status === 400 && /thinking/i.test(r.text) && body.generationConfig.thinkingConfig) { delete body.generationConfig.thinkingConfig; continue; }
        if (r.status === 401 && !o.token && attempt < 2) { tokenCache = { t: "", at: 0 }; continue; }   // an expired login: fetch a fresh token and try again
        if ((r.status === 429 || r.status >= 500) && attempt < 2) { await new Promise((z) => setTimeout(z, o.retryMs * (attempt + 1))); continue; }
        break;
      }
    } finally { reserved -= worst; }
    let j; try { j = JSON.parse(r.text); } catch (e) { j = {}; }
    const u = j.usageMetadata || {};
    const tin = u.promptTokenCount, tout = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    // a reply that reports no usage is NOT free: charge the worst case
    const cost = typeof tin === "number" ? gbp(model, tin, tout) : worst;
    spent += cost; calls++;
    const text = (((j.candidates || [])[0] || {}).content || {}).parts ? j.candidates[0].content.parts.map((p) => p.text || "").join("") : "";
    if (o.ledger) o.ledger.append("call", { label: a.label || "", model, status: r.status, prompt: { system: a.system || "", messages: a.messages }, reply: text, tokens: { in: tin, out: tout }, gbp: +cost.toFixed(6), spentGBP: +spent.toFixed(6) });
    if (r.status !== 200) { const e = new Error("model " + r.status + ": " + ((j.error || {}).message || "").slice(0, 160)); e.status = r.status; throw e; }
    return { text, tokens: { in: tin, out: tout }, gbp: cost };
  }
  return { ask, stats: () => ({ spentGBP: +spent.toFixed(4), capGBP: o.capGBP, calls, refused }), PRICES, gbp };
}
module.exports = { createClient, PRICES, USD_TO_GBP };
