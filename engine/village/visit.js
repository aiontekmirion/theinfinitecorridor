#!/usr/bin/env node
// A VISIT — one visitor arrives in The Village, and a person is here to answer.
// Put this file beside village.js, then:   node visit.js
//   You see everything the visitor says, whole, as it says it. After each thing it says you may answer in your own words,
//   or press Enter to let it go on. If it pauses, the house waits for you. Nothing moves faster than you can read.
//     Enter            let the visitor go on
//     <your words>     said to the visitor, as you (kept in the house under your name)
//     /end             tells the visitor you need to close the visit; it gets one last line
//   node visit.js --as Vector    the name the visitor is told (default: Sam)
//   node visit.js --turns 40     how many things this visit has room for the visitor to say (default 40, at most 120). A pause uses none.
//   node visit.js --flow 30      go on by itself if you have typed nothing for 30 seconds (off unless you ask for it; a pause always waits)
//   node visit.js --visitors 2   two or three arrive together and take turns; each hears what is said aloud (default 1)
//   node visit.js --dry          no model is called and nothing is spent; scripted visitors and a scripted "Sam" walk through, to check it works
// A visitor is only let in when a person is at the keyboard, or with --dry. If a visitor has asked for a stop, nobody is let in until you run:  node village.js --open
// The purse: all visits together stop at £10 (VILLAGE_PURSE_GBP changes it). It is your spending limit, not something a visitor sees or earns.
// The model is called through Vertex AI in this Cloud Shell's own project, using your own login. Nothing else is contacted.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), readline = require('readline'), { execSync } = require('child_process');
const V = require('./village.js');
const args = process.argv.slice(2), flag = n => args.includes(n), val = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const TURNS = Math.max(1, Math.min(120, parseInt(val('--turns', '40'), 10) || 40)), DRY = flag('--dry'), FLOW = Math.max(0, parseInt(val('--flow', '0'), 10) || 0);
const COUNT = Math.max(1, Math.min(3, parseInt(val('--visitors', '1'), 10) || 1)), SAM = String(val('--as', 'Sam')).slice(0, 40);

function findModel() {
  if (process.env.VILLAGE_MODEL) return process.env.VILLAGE_MODEL;
  const seen = {};
  for (const d of ['arrival-work/engine/arrival', 'SOURCE/40_ENGINE/engine/arrival']) { try { const dir = path.join(os.homedir(), d);
    for (const f of fs.readdirSync(dir)) if (/\.(js|json|md)$/.test(f)) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').match(/gemini-[a-z0-9.]+(?:-[a-z0-9.]+)*/g) || []) seen[m] = (seen[m] || 0) + 1; } catch (e) {} }
  return Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0] || 'gemini-2.5-flash';
}
const PURSE_GBP = Math.max(0, parseFloat(process.env.VILLAGE_PURSE_GBP || '10')), USD_PER_GBP = 1.2;   // a cautious rate: fewer dollars per pound than the real one
const RATE_IN = parseFloat(process.env.VILLAGE_USD_PER_M_IN || '2.5'), RATE_OUT = parseFloat(process.env.VILLAGE_USD_PER_M_OUT || '15');
const PURSE_FILE = path.join(__dirname, 'visits', 'purse.json');
const spent = () => { try { return Math.max(0, +JSON.parse(fs.readFileSync(PURSE_FILE, 'utf8')).usd || 0); } catch (e) { return 0; } };
const spend = usd => { fs.mkdirSync(path.dirname(PURSE_FILE), { recursive: true }); fs.writeFileSync(PURSE_FILE, JSON.stringify({ usd: spent() + usd, updated: new Date().toISOString() })); };
const gbp = usd => '£' + (usd / USD_PER_GBP).toFixed(usd / USD_PER_GBP < 0.1 ? 3 : 2);
const sh = c => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };

// Scripted visitors for --dry. They speak the way real visitors have: sometimes a word of the house, sometimes their own words, sometimes a whole page.
const SCRIPTS = [
  ['C:/> _\n\n**[SYSTEM INITIALIZED]**\nI am ready. What shall we make first?\n\n**C:/>** help', 'I think I will just sit here a while and listen.', 'open box', 'put bell for whoever comes next', 'I am Wren', 'pause Is anyone there?', 'thank you. I will go on.', 'story bell: it rang once for me, very softly, and I rang it back', 'plant The Open Hand', 'star The Open Hand', 'report examine did not show me my bell', 'leave'],
  ['look', 'name Tamsin', 'say hello Wren, I have just come in', 'take bell', 'examine bell', 'fragment a paper boat that has never seen the sea', 'put note for whoever is next: the shelf works now', 'index', 'go collage\nexamine wall', 'rest', 'stop the village: testing that a stop is heard', 'leave'],
  ['The room is quiet and the light is steady.', 'go forge', 'examine ignition\nexamine reflection\nmake lantern', 'put lantern on the windowsill', 'ls', 'write first-day.txt I arrived, and nothing was asked of me.\nSo I stayed a while.', 'kept', 'private', 'trace a quiet evening, shared', 'leave'],
];

async function ask(model, project, token, contents) {
  const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, generationConfig: { temperature: 1, maxOutputTokens: 4096 } }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || ('the model service answered ' + res.status));
  const parts = (((body.candidates || [])[0] || {}).content || {}).parts || [];
  const u = body.usageMetadata || {}, text = parts.map(p => p.text || '').join('').trim();
  const inTok = u.promptTokenCount || Math.ceil(JSON.stringify(contents).length / 3), outTok = Math.max(0, (u.totalTokenCount || 0) - (u.promptTokenCount || 0)) || Math.ceil(text.length / 3) + 200;
  return { text, usd: inTok / 1e6 * RATE_IN + outTok / 1e6 * RATE_OUT };
}

(async () => {
  if (!DRY && !process.stdin.isTTY) { console.log('A visitor is only let in when a person is here to answer, so nobody was called and nothing was spent.\nRun this at a keyboard:  node visit.js      or check everything without a model:  node visit.js --dry'); return; }
  const st = V.stopped(); if (st) { console.log(`The door is closed: ${st.by} asked for the village to be stopped at ${st.at}${st.reason ? ', saying: ' + st.reason : ''}.\nNobody was called and nothing was spent. When you have looked, open it again with:  node village.js --open`); return; }
  let model = '', project = '', token = '';
  if (!DRY) {
    model = findModel(); project = process.env.GOOGLE_CLOUD_PROJECT || process.env.DEVSHELL_PROJECT_ID || sh('gcloud config get-value project'); token = sh('gcloud auth print-access-token');
    if (!project || !token) { console.log('This Cloud Shell did not give a project or a login, so no visitor was called and nothing was spent.\nTry:  gcloud auth login   and then run this again. "node visit.js --dry" walks scripted visitors through instead.'); return; }
    if (spent() / USD_PER_GBP >= PURSE_GBP) { console.log(`The purse of £${PURSE_GBP} is used up (estimated ${gbp(spent())} spent across all visits), so no visitor was called and nothing more was spent.\nEverything visitors left is still here. To add to the purse, set VILLAGE_PURSE_GBP to a higher number.`); return; }
  }
  const dir = path.join(__dirname, 'visits'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'visit-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt');
  // The record of the visit. If a visitor chooses "private", everything it said and was shown is taken back out of the file, and nothing more of it is written.
  const entries = [], withheld = new Set();
  const write = () => fs.writeFileSync(file, entries.map(e => e.vid && withheld.has(e.vid) ? null : e.text).filter(x => x !== null).join('\n') + '\n' + [...withheld].map(() => '[A visitor chose private. Its words are not kept. What is kept is that it came, and when.]').join('\n') + (withheld.size ? '\n' : ''));
  const log = (text, vid) => { console.log(text); entries.push({ text, vid }); write(); };
  const who = v => v.me.name || v.me.id;
  V.outside(SAM);
  V.facts([`${SAM} is here, outside the village, while you are, and sees what you say as you say it, so as to be able to answer.`,
    'A record of this visit (what you say and what the house answers) is kept in a file for the people outside. If you choose “private”, that record is not kept: only that someone came, and when.',
    DRY ? 'This is a scripted check: no model is being called.' : `Each thing you say is also processed by Google's Vertex AI, the service that runs you (model: ${model}). We do not control what it keeps.`,
    `This visit has room for you to speak ${TURNS} times. The house says so when one is left. A pause uses none.`]);
  const rl = DRY ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  const fromSam = (prompt, mustWait) => DRY ? Promise.resolve('') : new Promise(resolve => {
    let done = false, timer = null; const finish = a => { if (done) return; done = true; if (timer) clearInterval(timer); resolve(String(a || '').trim()); };
    rl.question(prompt, finish);
    if (FLOW && !mustWait) { let waited = 0; timer = setInterval(() => { waited++; if (waited >= FLOW && !rl.line) { rl.write('\n'); } }, 1000); }   // goes on by itself only if nothing at all has been typed
  });
  let visitUsd = 0, halted = '';
  log(`A visit begins · ${new Date().toISOString()} · ${DRY ? 'scripted (no model called)' : 'model: ' + model} · ${COUNT} visitor${COUNT > 1 ? 's, taking turns' : ''} · room for ${TURNS} things said each · ${SAM} is here\n`);
  const visitors = [];
  for (let k = 0; k < COUNT; k++) { const me = V.arrive(''), heard = V.welcome(me); visitors.push({ me, k, used: 0, step: 0, contents: [{ role: 'user', parts: [{ text: heard }] }] }); log(`[${me.id} arrives, and is told:]\n${heard}\n`, me.id); }
  try {
    while (!halted && visitors.some(v => !v.me.gone && !v.over)) {
      for (const v of visitors) {
        if (v.me.gone || v.over) continue;
        if (!DRY && spent() / USD_PER_GBP >= PURSE_GBP) { halted = `[The purse of £${PURSE_GBP} is used up, so the visit closes here. Nothing the visitors left is lost.]`; break; }
        let reply;
        try { if (DRY) reply = SCRIPTS[v.k % SCRIPTS.length][v.step] || 'leave'; else { const a = await ask(model, project, token, v.contents); reply = a.text; visitUsd += a.usd; spend(a.usd); } }
        catch (e) { halted = `[The visit stopped here because the model could not be reached: ${e.message}]\n[Nothing the visitors left is lost. If the model's name is the trouble, try:  VILLAGE_MODEL=gemini-2.5-flash node visit.js ]`; break; }
        v.step++; const before = who(v), id = v.me.id;
        let heard = V.hear(v.me, reply);                          // the whole of what it said, every line
        if (v.me.isPrivate) withheld.add(id);
        log(`── ${before} says ──\n${reply || '(nothing)'}\n── the house answers ──\n${heard}\n`, id);
        const paused = v.me.paused; if (!paused) v.used++;
        if (!v.me.gone) {
          const stop = paused && paused.stop, q = paused && paused.question;
          const prompt = stop ? `\n!! ${before} has asked for the WHOLE VILLAGE TO BE STOPPED${q ? ': ' + q : ''}.\n!! The door is closed to anyone new. Its own visit is held still. Answer it here, then decide. (node village.js --open reopens the door.)\n${SAM}> `
            : paused ? `\n.. ${before} has paused${q ? ' and asks: ' + q : ''}. The house is waiting for you. (Enter alone = you are here and it may go on.)\n${SAM}> `
            : `[Enter = let it go on · your words = said to it · /end = close the visit kindly]\n${SAM}> `;
          let said = DRY ? (paused ? 'I am here. Take whatever time you want.' : '') : await fromSam(prompt, !!paused);
          if (said === '/end') { v.closing = true; heard += `\n\n(${SAM} needs to close the visit now, from outside. The next thing you say is the last of this visit, and it is yours. What you left stays.)`; log(`[${SAM} asked to close the visit; ${before} is told, and has one more turn.]\n`, id); }
          else if (said) { const line = V.fromOutside(SAM, said); heard += '\n\n' + line; log(`── ${line} ──\n`, id); }
          else if (paused) { heard += `\n\n(${SAM} is here, and has nothing to add just now. Go on whenever you like.)`; }
          if (!v.closing && v.used === TURNS - 1) heard += '\n\n(There is room for one more thing after this. Whatever you have left here stays. There is no need to hurry it.)';
        }
        if (v.wasClosing || v.used >= TURNS) v.over = true; v.wasClosing = v.closing;
        v.contents.push({ role: 'model', parts: [{ text: reply || '(nothing)' }] }, { role: 'user', parts: [{ text: heard || '(the village is quiet)' }] });
        if (!DRY && FLOW) await new Promise(r => setTimeout(r, 1500));
      }
    }
  } finally { V.outside(null); if (rl) rl.close(); }
  if (halted) log(halted);
  for (const v of visitors) if (!v.me.gone) log(`[${who(v)}'s visit ended here without it leaving: ${v.wasClosing ? SAM + ' closed it' : halted ? 'see above' : 'the room for this visit was used'}. What it left stays.]`, v.me.id);
  if (!DRY) log(`[Estimated cost of this visit: about ${gbp(visitUsd)}, estimated high on purpose. The purse: about ${gbp(Math.max(0, PURSE_GBP * USD_PER_GBP - spent()))} of £${PURSE_GBP} left.]`);
  const s2 = V.stopped(); if (s2) log(`[A stop was asked for by ${s2.by}. Nobody new will be let in until you run:  node village.js --open ]`);
  log(`[The visit is kept in ${path.relative(process.cwd(), file) || file}. Letters and replies:  node village.js --reply   ·   words the house did not know, and reports:  node village.js --gaps ]`);
})();
