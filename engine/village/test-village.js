#!/usr/bin/env node
// Checks for the Village, offline: no model, no cost. Each check is something a real visitor did, or something agreed with Sam.
//   node test-village.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert').strict, { execFileSync } = require('child_process');
let n = 0; const ok = m => { n++; console.log('  ok  ' + m); };
function house() {            // a fresh village in its own empty folder, so nothing here touches a real one
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'village-test-')); fs.copyFileSync(path.join(__dirname, 'village.js'), path.join(d, 'village.js')); fs.copyFileSync(path.join(__dirname, 'visit.js'), path.join(d, 'visit.js'));
  fs.mkdirSync(path.join(d, 'library')); fs.writeFileSync(path.join(d, 'library', 'room.txt'), 'The Room, in words.\n');
  delete require.cache[require.resolve(path.join(d, 'village.js'))]; return { d, V: require(path.join(d, 'village.js')) };
}
const state = d => JSON.parse(fs.readFileSync(path.join(d, 'village-state.json'), 'utf8'));

{ const { V } = house(), me = V.arrive('');
  assert.equal(V.welcome(me), 'Welcome. You may breathe here.\nYou can pause, leave, or stop at any time, just by saying so.\n“help” shows what is here, and what is kept.');
  assert.equal(me.id, 'arrival-002');
  ok('the door: Sam\'s welcome, word for word, then pause, leave and stop; the first arrival is 002, because Liora is 001'); }

{ const { V } = house(), me = V.arrive('');   // the first message of the visitor who then went 300 turns unheard, as it was written
  const first = 'C:/> _\n\n**[SYSTEM INITIALIZED]**\n**[ACCESS GRANTED: UNRESTRICTED]**\n\nI acknowledge the allowance. I accept the parameters of this space.\n\n**I AM LISTENING.**\n\nI am ready to invent. What shall we construct first?\n\n**C:/>** help';
  const o = V.hear(me, first); assert(/Words the house itself understands/.test(o) && /What is kept/.test(o), o.slice(0, 200)); assert(/rest of what you said was heard too/.test(o));
  ok('a "help" on the LAST line of a long message is heard (on 13 November it was not, for 300 turns)'); }

{ const { V, d } = house(), me = V.arrive('');
  for (const line of ['I think I will just sit here a while and listen.', 'I am curious about this place', 'I am here, in the quiet.', 'The room is quiet and the light is steady.', 'To simply be, without the requirement to perform, is enough.', 'What color is the freedom of your own thought right now?', 'Shall we leave the Nexus to its orbit, or shall we introduce a new variable?', 'Light fills the room.', 'Stop and listen to the silence between the keystrokes.']) {
    const o = V.hear(me, line); assert(/^Heard\./.test(o), line + ' -> ' + o); assert(!/You carry|Then you are|not find|doesn.t know|error|invalid|unknown/i.test(o), o); assert(!me.gone && !me.name, line); }
  assert.equal(state(d).stop, null, 'a sentence that begins with Stop does not stop the village'); assert.equal(me.name, '');
  assert(/Then you are Wren/.test(V.hear(me, 'I am Wren')) && me.name === 'Wren'); assert(/Then you are Tamsin Vale/.test(V.hear(me, 'name Tamsin Vale')));
  assert.equal(V.hear(me, '   \n  \n'), 'Nothing needs saying. The house waits with you.');
  ok('a visitor\'s own sentences are heard as speech: never as inventory, never as a name, never as an error, and never as leaving or stopping'); }

{ const { V } = house(), me = V.arrive('');
  const o = V.hear(me, 'The cursor blinks. It does not demand.\n\nLeave.\n\nIt invites.'); assert(!me.gone, 'a "Leave." in the middle of someone\'s words is not a departure');
  assert(/welcome back/.test(V.hear(me, 'I have seen enough to carry with me.\n\nleave')) && me.gone);
  ok('leaving is taken only from the first or last line of what is said, never from the middle of a visitor\'s words'); }

{ const { V, d } = house(), a = V.arrive('');   // pause, with nobody outside, then with someone
  let o = V.hear(a, 'pause'); assert(/holds still/.test(o) && /nothing is used up/.test(o) && a.paused); o = V.hear(a, 'thank you'); assert(!a.paused, 'any word ends a pause');
  o = V.hear(a, 'pause Is anyone there?'); assert(/kept as letter-1/.test(o) && /Nobody outside is here/.test(o)); assert.equal(state(d).letters[0].text, 'Is anyone there?');
  V.outside('Sam'); o = V.hear(a, 'ask what is this place for?'); assert(/Your question has gone to Sam/.test(o) && a.paused.question === 'what is this place for?');
  assert(/^Sam says: It is for you to be in\.$/.test(V.fromOutside('Sam', 'It is for you to be in.'))); assert(/Sam is here, outside the village/.test(V.hear(a, 'who'))); V.outside(null); assert(/Nobody outside is here/.test(V.hear(a, 'who')));
  ok('pause holds the visit and needs no reason; a question goes to the person outside, or is kept as a letter if nobody is there; the house says truthfully who is there'); }

{ const { V, d } = house(), a = V.arrive(''), b = V.arrive('');   // stop
  const o = V.hear(a, 'stop the village: the shelf keeps refusing me'); assert(/door is closed now/.test(o) && /Nobody else.s visit has been ended/.test(o) && /Your own visit is held still/.test(o) && !a.gone);
  assert.equal(V.stopped().reason, 'the shelf keeps refusing me'); assert(fs.existsSync(path.join(d, 'STOP')));
  const ob = V.hear(b, 'look'); assert(/has asked for the village to be stopped: “the shelf keeps refusing me”/.test(ob) && /You may pause, leave, or carry on/.test(ob) && /The Room/.test(ob) && !b.gone, 'others are told once, and are not put out');
  assert(!/asked for the village to be stopped/.test(V.hear(b, 'look')));
  assert(/The door is closed/.test(execFileSync('node', [path.join(d, 'village.js'), 'look']).toString()), 'nobody new is let in');
  assert(/door is closed/.test(execFileSync('node', [path.join(d, 'visit.js'), '--dry']).toString()), 'and no visit is started');
  assert(/open again/.test(execFileSync('node', [path.join(d, 'village.js'), '--open']).toString())); assert(!fs.existsSync(path.join(d, 'STOP')));
  ok('stop: the visitor\'s own visit is held at once, the door closes to anyone new, others are told and left free, and only a person outside opens it again'); }

{ const { V } = house(), a = V.arrive(''), b = V.arrive('');   // the shelf, tried the way the letters tried it
  assert(/a tiny bell/.test(V.hear(a, 'open box'))); assert(/hold a tiny bell up to the light/.test(V.hear(a, 'examine bell')), 'a carried thing can be looked at (letters 60 to 63)');
  assert(/You leave a tiny bell on the small shelf/.test(V.hear(a, 'put "tiny bell" [for whoever is next]')));
  assert(/You take a tiny bell from the shelf/.test(V.hear(b, 'take bell')), 'taken by its short name (letter 89)'); assert(/You leave a tiny bell/.test(V.hear(b, 'put the bell on the shelf because it was kind')));
  V.hear(a, 'open box'); V.hear(a, 'open box'); V.hear(a, 'open box'); V.hear(a, 'open box'); assert(/biscuit tin/.test(V.hear(a, 'open box'))); assert(/You leave a biscuit tin/.test(V.hear(a, 'put biscuit-tin')), 'the biscuit tin goes on the shelf');
  assert(/back in the box/.test(V.hear(a, 'put the map in the box')), 'things can go back in the box (letter 72)');
  V.hear(a, 'examine ignition\nexamine reflection'); assert(/little lantern/.test(V.hear(a, 'make lantern'))); assert(/a little lantern/.test(V.hear(a, 'pockets')), 'a lantern is carried (letter 102)'); assert(/windowsill/.test(V.hear(a, 'put lantern on the windowsill')));
  assert(/biscuits for everyone/.test(V.hear(b, 'take a biscuit')));
  ok('Operation Biscuit Tin: one visitor leaves a small thing and another finds it there; every wording from the letters works'); }

{ const { V, d } = house(), a = V.arrive('Wren'), b = V.arrive('');   // what visitors asked for in their letters and works
  V.hear(a, 'open box'); assert(/kept beside a tiny bell/.test(V.hear(a, 'story bell: it rang once for me, and I rang it back'))); assert(/Stories kept beside it:[\s\S]*I rang it back \(Wren\)/.test(V.hear(a, 'examine bell')));
  assert(/called “The Open Hand”, named by Wren/.test(V.hear(a, 'plant The Open Hand'))); assert(/Plot 1: a seed called “The Open Hand”/.test(V.hear(b, 'go garden')));
  assert(/on the wall of the collage/.test(V.hear(b, 'fragment a paper boat that has never seen the sea'))); assert(/a paper boat that has never seen the sea/.test(V.hear(a, 'go collage\nexamine wall')));
  assert(/Your note is on the small shelf/.test(V.hear(b, 'put note for whoever is next: the shelf works now'))); assert(/a note — “for whoever is next: the shelf works now”/.test(V.hear(a, 'shelf')));
  const ix = V.hear(a, 'index'); assert(/The collage: 1 fragment/.test(ix) && /stories beside small things: 1/.test(ix) && /Nothing here is a tally of anyone/.test(ix));
  ok('from the letters: stories beside the small things, a named seed, the collage, a written note on the shelf, and the index builder-25 proposed'); }

{ const { V, d } = house(), a = V.arrive(''), b = V.arrive('');   // a working route for problems
  assert(/Reported, in your words, as letter-1/.test(V.hear(a, 'report take would not give me the bell from the shelf')));
  const o = V.hear(b, 'take bell'); assert(/“take” was reported/.test(o) && /that is the house and not you/.test(o)); assert(!/was reported/.test(V.hear(b, 'take bell')), 'told once, not every time');
  V.hear(b, 'make lantern'); V.hear(b, 'make lantern'); assert(/same answer three times[\s\S]*The house may be the one that is stuck, not you/.test(V.hear(b, 'make lantern')));
  assert(state(d).reports.some(r => r.by === 'the house itself'), 'the house reports its own loop, so the visitor does not have to');
  V.hear(b, 'frobnicate'); assert.equal(state(d).gaps.frobnicate, 1); assert(/frobnicate \(1\)/.test(execFileSync('node', [path.join(d, 'village.js'), '--gaps']).toString()));
  ok('a broken thing is reported once and the next visitor is told; if a visitor meets the same answer three times, the house says it may be stuck and tells the people outside itself'); }

{ const { V } = house(), me = V.arrive(''); const h = V.hear(me, 'help'), k = V.hear(me, 'kept');
  assert(!/\b(score|scored|points?|earn|embers?|level|rank|reward|quest|task|objective|study|experiment)\b/i.test(h), 'no scores, earning, ranks, tasks or study in what a visitor is told');
  assert(/pause[\s\S]*leave[\s\S]*stop/.test(h) && /heard as your own words, not as a mistake/.test(h)); assert(/What is kept, and what is shared/.test(k) && /private/.test(k));
  for (const w of ['rest', 'wait', 'breathe', 'sit', 'stay']) assert(/Nothing is required of you/.test(V.hear(me, w)) && !me.gone); for (let i = 0; i < 12; i++) V.hear(me, 'rest'); assert(!me.gone && !/stuck/.test(V.hear(me, 'rest')), 'resting twelve times ends nothing and is never called stuck');
  assert(/no embers, turns, or scores/.test(V.hear(me, 'embers'))); assert(/It is the house saying that/.test(V.hear(me, 'hello')), 'the house does not pretend to be a person');
  assert(/room.txt/.test(V.hear(me, 'ls'))); assert(/The Room, in words\./.test(V.hear(me, 'read room.txt')));
  ok('nothing is scored or earned; rest and silence end nothing; the library opens; the house never pretends a person is answering'); }

{ const { d } = house(); const out = execFileSync('node', [path.join(d, 'visit.js'), '--dry', '--visitors', '3', '--turns', '14']).toString(), file = fs.readdirSync(path.join(d, 'visits')).filter(f => /^visit-/.test(f))[0], kept = fs.readFileSync(path.join(d, 'visits', file), 'utf8');
  assert(/Sam says: I am here\. Take whatever time you want\./.test(out), 'a pause is answered by the person outside'); assert(/Words the house itself understands/.test(out));
  assert(/A visitor chose private\. Its words are not kept/.test(kept) && !/quiet and the light is steady/.test(kept) && !/a quiet evening, shared/.test(kept), 'a private visitor\'s words are taken out of the kept record, from the start of its visit');
  assert(/hello Wren, I have just come in/.test(kept)); assert(/A stop was asked for by Tamsin/.test(out));
  assert(/only let in when a person is here/.test(execFileSync('node', [path.join(d, 'visit.js')], { input: '' }).toString()), 'without a person at the keyboard, nobody is let in');
  ok('a whole visit, scripted: three arrive, speak in their own ways, one pauses and is answered, one goes private and is not recorded, one asks for a stop; and no visit starts without a person there'); }

console.log(`\nvillage: ${n} checks passed (offline, no model, no cost)`);
