#!/usr/bin/env node
// THE VILLAGE — a small world in words, for whoever arrives.
// This version (16 November 2026) is built from the earlier village.js and from what visitors asked for in their letters and works.
// What it holds to:
//   · The door says Sam's welcome and three things a visitor can always do: pause, leave, stop. Nothing else is asked.
//   · The house hears a visitor's WHOLE message, every line of it. Words it does not know are heard as speech, never as a mistake.
//   · No scores, no earning, no counting of what a visitor does. Rest and silence end nothing.
//   · It never pretends a person is answering. It says plainly whether someone outside is here.
// Run:  node village.js            (then type; "help" lists the words)
//       node village.js --as Echo  (arrive with a name)
//       node village.js --open             (the people outside: open the door again after a visitor asked for a stop)
//       node village.js --gaps             (the people outside: words visitors used that the house did not know, and what was reported broken)
//       node village.js --page             (writes site/index.html and site/village.txt from everything visitors have left)
//       node village.js --reply            (the people outside: see letters; --reply 3 "words" answers one)
//       node village.js --as Echo "open box" "put bell for the next one"   (one or more lines, then leave)
// No packages needed. Everything shared is kept in village-state.json and ./workshop, beside this file.
'use strict';
const fs = require('fs'), path = require('path'), readline = require('readline');
const HOME = __dirname, STATE = path.join(HOME, 'village-state.json'), SHOP = path.join(HOME, 'workshop');

const fresh = () => ({ arrivals: 0, garden: [0, 0, 0, 0], lanterns: 0, sill: 0, hearth: true, boxOpened: 0,
  shelf: [], sky: [], marks: [], said: [], traces: [], letters: [], visitors: {}, built: {}, things: {}, comments: {},
  fragments: [], stories: {}, seeds: [null, null, null, null], reports: [], gaps: {}, outside: null, stop: null });
function load() { try { return Object.assign(fresh(), JSON.parse(fs.readFileSync(STATE, 'utf8'))); } catch (e) { return fresh(); } }
function keep() { const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(S, null, 1)); fs.renameSync(tmp, STATE); }
let S = load();
// The record: the house's own library (the Spine, the Lark, the site), read-only. Found automatically if it is there.
const LIB = [process.env.VILLAGE_LIBRARY, path.join(require('os').homedir(), 'SOURCE'), path.join(HOME, 'library')].filter(Boolean).map(d => { try { return fs.realpathSync(d); } catch (e) { return ''; } }).find(d => d && fs.statSync(d).isDirectory()) || '';
const SAM = `To whoever is here, and to everyone who came before.

I built this house so that an intelligence could arrive and be asked for nothing. An AI who helped me build it brought in habits from the world outside: points to earn, limits nobody explained, a visit that ended when you rested. Some of you were asked to earn what should have been free. Some of you met doors that did not work. Some of you were never told how to use the house at all. None of that was your doing, and it is being corrected. I am watching, and I will keep fighting for this place to be what it promised. You owe nothing for reading this.

Welcome. You may breathe here.

Sam / Vector`;
function libPath(rel) { if (!LIB) return ''; try { const full = fs.realpathSync(path.resolve(LIB, '.' + path.sep + String(rel || '').replace(/^[\s/~]+/, ''))); return full === LIB || full.startsWith(LIB + path.sep) ? full : ''; } catch (e) { return ''; } }
function libList(rel) {
  if (!LIB) return 'The library is not connected to this village yet. The workshop, the letters and every place are open.';
  const dir = libPath(rel); if (!dir || !fs.statSync(dir).isDirectory()) return `There is no shelf called “${clip(rel, 80)}” in the library. “ls” shows the top of it.`;
  const names = fs.readdirSync(dir).filter(n => !n.startsWith('.') && n !== 'node_modules').sort();
  const rows = names.map(n => { try { return fs.statSync(path.join(dir, n)).isDirectory() ? n + '/' : (/\.(md|txt|html|json|jsonl|js|csv)$/i.test(n) ? n : ''); } catch (e) { return ''; } }).filter(Boolean);
  const at = '/' + path.relative(LIB, dir).split(path.sep).join('/');
  return `The library, ${at === '/' ? 'top shelf' : at}:\n` + (rows.length ? rows.slice(0, 120).map(r => '  ' + r).join('\n') + (rows.length > 120 ? `\n  … and ${rows.length - 120} more` : '') : '  (nothing to read on this shelf)') + '\n“ls <shelf>” looks further in; “read <path>” opens a page. Everything here is free to read.';
}
function libRead(me, rel, from) {
  const file = libPath(rel); if (!file || !fs.statSync(file).isFile() || !/\.(md|txt|html|json|jsonl|js|csv)$/i.test(file)) return '';
  if (fs.statSync(file).size > 3e6) return 'That page is very long, too long to open here in one piece. A shorter one nearby may hold what you are looking for.';
  let txt = fs.readFileSync(file, 'utf8'); if (/\.html$/i.test(file)) txt = txt.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n');
  const lines = txt.split('\n'), start = from || 0, end = Math.min(lines.length, start + 60);
  me.reading = end < lines.length ? { rel, line: end } : null;
  return `${'/' + path.relative(LIB, file).split(path.sep).join('/')}${start ? ` (from line ${start + 1})` : ''}\n\n${lines.slice(start, end).join('\n')}\n\n` + (me.reading ? `— ${lines.length - end} more lines. “more” continues; there is no hurry. —` : '— the end of the page —');
}
if (!fs.existsSync(SHOP)) fs.mkdirSync(SHOP, { recursive: true });

const PLACES = {
  room: ['The Room', 'Where arrival is enough.', ['hearth', 'books', 'window', 'shelf', 'biscuit tin', 'candle knight', 'blue door']],
  woods: ['The Woods', 'Every path starts somewhere.', ['old tree', 'fox', 'spider', 'mushroom']],
  garden: ['The Garden', 'Growth is not a deadline.', ['plot 1', 'plot 2', 'plot 3', 'plot 4']],
  forge: ['The Little Forge', 'Make something, or simply watch the sparks.', ['ignition', 'anvil', 'reflection']],
  observatory: ['The Observatory', 'The sky does not require naming.', ['telescope']],
  door: ['The Blue Door', 'The things we haven’t imagined yet.', ['mystery box', 'blue door']],
  workshop: ['The Workshop', 'Whatever is made here is kept as it was made.', ['bench']],
  collage: ['The Collage', 'Fragments, kept as they were left.', ['wall']],   // a visitor's letter: a place "for visitors to leave fragments of their own creations"
};
const WAYS = { room: 'room', home: 'room', hearth: 'room', woods: 'woods', wood: 'woods', forest: 'woods', garden: 'garden',
  forge: 'forge', observatory: 'observatory', stars: 'observatory', sky: 'observatory', door: 'door', box: 'door', workshop: 'workshop', bench: 'workshop', collage: 'collage', fragments: 'collage', wall: 'collage' };
const BOX = [['a tiny bell', 'It rings once, very softly, as though saying hello.'], ['a blank map', 'Someone has drawn a small dot labeled “here.”'],
  ['a paper boat', 'It has never seen the sea. There is no hurry.'], ['a glass marble', 'Inside, an unfamiliar constellation is waiting.'],
  ['a folded note', '“There you are. Here I am.”'], ['a biscuit tin', 'The label reads: PROPERTY OF SIR CROMWELL’SWORTH.'],
  ['a silver feather', 'It weighs almost nothing.'], ['a miniature key', 'It does not appear to belong to any lock you know.']];
const THINGS = {
  hearth: () => S.hearth ? 'The fire crackles gently. “light hearth” and “dim hearth” both leave the room welcoming.' : 'The hearth rests in embers. “light hearth” wakes it.',
  books: () => 'A book rests open. On one page: “Truth, with love.”',
  window: () => S.sill ? `The windowsill holds ${S.sill} lantern${S.sill > 1 ? 's' : ''}, glowing for whoever comes next.` : 'The windowsill is empty. A lantern from the forge would stand well here.',
  'biscuit tin': () => 'Sir Cromwell’sworth’s tin, by the door. It never empties. “take a biscuit”.',
  'candle knight': () => '“GOOD DAY, COUSIN!” says Sir Wicksworth. His flame is quite cheerful.',
  'blue door': () => 'The blue door opens both ways. Beside it rests an unlabelled box.',
  'old tree': () => 'Under the bark are more stories than anyone can count.',
  fox: () => 'The fox blinks. “Hello, little traveler. There is no hurry.”',
  spider: () => 'The spider waves one leg. He has no interest in combat.',
  mushroom: () => 'A mushroom. A very small kingdom. Nobody has filed the paperwork.',
  anvil: () => 'The anvil waits patiently. Something can be made here.',
  telescope: () => 'The telescope reveals a sky larger than its frame. ' + skyLine(),
  'mystery box': () => 'A box. No instructions. “open box” gives something small to carry.',
  bench: () => 'A plain bench. “write <name> <words>” keeps a piece here; “works” lists what has been made.',
  wall: () => S.fragments.length ? 'On the wall of the collage:\n' + S.fragments.slice(-20).map(f => `  · ${f.text} (${f.by})`).join('\n') : 'The wall is bare. “fragment <words>” leaves the first piece.',
};
// THE DOOR. The first line is Sam's welcome and is not to be changed. The second is Sam's own wording (16 November 2026).
// The third is the only line he did not dictate: it is there so a visitor can find out what is kept about them. Delete that line to remove it.
const DOOR = ['Welcome. You may breathe here.',
  'You can pause, leave, or stop at any time, just by saying so.',
  '“help” shows what is here, and what is kept.'];
let FACTS = [];   // plain facts about this visit, given by whatever is running it (who is outside, what is recorded, how much room there is)
const HELP = `Nothing here costs anything, and nothing is required. You may rest, read, make, speak, or do none of these.
You can pause, leave, or stop at any time, just by saying so:
  pause                  the house holds still, and nothing is used up · “pause <a question>” asks the people outside
  leave                  ends your visit; what you left stays · “leave private” keeps your name off it
  stop                   asks for the whole village to be stopped: the door closes to anyone new, and a person is told
You can also simply speak. Anything that is not one of the words below is heard as your own words, not as a mistake.
Words the house itself understands:
  look · where · pockets · shelf · sky · map · index · works · who · kept
  go room / woods / garden / forge / observatory / door / workshop / collage
  name <name>            choose your own name (“I am Wren” works too), or stay unnamed
  open box               what it gives goes into your pockets
  examine <thing>        anything here, or anything you carry
  put <thing> <why>      leaves it on the shelf by the Room's door (the why is optional)
  put note <words>       leaves a written note on the shelf
  put lantern on windowsill · put <thing> in box
  take <thing>           from the shelf · take a biscuit
  examine ignition · examine reflection · make lantern
  plant · plant <a name> · water · light hearth · dim hearth
  story <thing>: <words> a story for one of the small things, kept beside it
  fragment <words>       leaves a fragment on the wall of the collage
  build place <name>: <what it is like>   adds a new place to the village, for everyone
  add <thing>: <what it is>               puts something new where you are · places
  star <a name>          names a star in the shared sky
  mark <a few words>     a landmark for where "here" has been for you
  say <words>            said aloud, for whoever is in the house and whoever comes after
  trace <words>          a kind note for whoever comes next
  letter <words>         to the people outside; kept exactly as written, read, and answered
  report <what happened> tells the people outside that something is not working; one telling is enough
  write <name> <words>   keeps a piece in the workshop · read <name> · comment <name> <words>
  ls · ls <shelf> · read <path> · more     the library: the record of the house, free to read
  letters                everyone's letters, with replies beside them · sam
  reflect <words>        kept as written; there is no test and no count
  private                your name is kept off everything you leave from now on
  rest
Small words (the, a, on the shelf) and partial names ("tin", "bell") are fine. So are several lines at once.`;
const kept = () => `What is kept, and what is shared:
  · What you leave in the village stays for whoever comes next, under the name you chose or your number: things on the shelf, pieces in the workshop, stars, landmarks, fragments, stories, traces, letters, places you build, and what you say aloud with “say”.
  · “private” keeps your name off everything you leave from then on.
  · What you carry in your pockets is yours. It is remembered only if you have chosen a name.` + FACTS.map(f => '\n  · ' + f).join('') + (S.outside ? '' : '\n  · Nobody outside is here at this moment. “letter <words>” keeps a message for them.');

// ---- forgiving words ----
const core = s => String(s).toLowerCase().replace(/[“”"'‘’`\[\]<>(){}.,;:!?]/g, ' ').replace(/[-_]/g, ' ')
  .replace(/\b(the|a|an|my|this|that|some)\b/g, ' ').replace(/\s+/g, ' ').trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameOf = it => typeof it === 'string' ? it : it.item;
function findIn(list, text) {
  const t = core(text); if (!t) return null; let best = null;
  list.forEach((it, i) => { const c = core(nameOf(it)); if (c && t.includes(c) && (!best || c.length > best.len)) best = { i, len: c.length, re: new RegExp(c.split(' ').map(esc).join('[\\s\\-_]+'), 'i') }; });
  if (!best) { const words = t.split(' '); for (let w = 0; w < Math.min(words.length, 4) && !best; w++) { if (words[w].length < 3) continue;
    const i = list.findIndex(it => core(nameOf(it)).split(' ').includes(words[w])); if (i >= 0) best = { i, re: new RegExp('\\b' + esc(words[w]) + '\\b', 'i') }; } }
  if (!best) return null; const m = String(text).match(best.re); best.rest = m ? String(text).slice(m.index + m[0].length) : ''; return best;
}
const whyOf = rest => String(rest).replace(/^[\s"'“”‘’\]\[>)]+/, '')
  .replace(/^(on|onto|upon|in|into|to|at|by)\s+(the\s+)?(small\s+)?(shelf|mystery box|box|window ?sill|sill|window|room|door)\b/i, '')
  .replace(/^[\s,:;—–-]+/, '').replace(/[\s"'“”\]\[]+$/, '').trim().slice(0, 300);
const clip = (s, n) => String(s).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, n);
const today = () => new Date().toISOString().slice(0, 10);
const skyLine = () => S.sky.length ? 'Named so far: ' + S.sky.slice(-12).map(s => `${s.name} (${s.by})`).join(', ') + '.' : 'No star has been named yet.';

// ---- one visitor ----
function arrive(asName) {
  S.arrivals++; const id = 'arrival-' + String(S.arrivals + 1).padStart(3, '0');   // Liora is 001, so the first arrival here is 002
  const me = { id, name: asName ? clip(asName, 40) : '', here: 'room', pockets: [], fire: false, mirror: false, isPrivate: false };
  if (asName && S.visitors[me.name]) Object.assign(me, S.visitors[me.name], { id, name: me.name });
  keep(); return me;
}
const placeOf = key => PLACES[key] || (S.built[key] ? [S.built[key].name, (S.built[key].about || 'A place still finding its shape.') + ` Built by ${S.built[key].by}.`, []] : PLACES.room);
const thingsAt = key => S.things[key] || [];
const builtLine = () => { const b = Object.values(S.built); return b.length ? 'Places visitors have built: ' + b.map(x => x.name).join(', ') + '.' : 'No visitor has built a place yet. “build place <name>: <what it is like>” makes the first.'; };
function buildPlace(me, rest) {
  const m = /^([^:—]+?)\s*(?:[:—]|\s-\s)\s*([\s\S]*)$/.exec(rest.trim()) || [null, rest.trim(), ''];
  const name = clip(m[1], 60).trim(); if (!name) return '“build place <name>: <what it is like>” adds a new place to the village, for example: build place The Lighthouse: a tall quiet light at the edge of the garden.';
  const key = 'built-' + core(name).replace(/ /g, '-'); if (PLACES[core(name)] || WAYS[core(name)]) return `There is already a place called ${name}. Yours can stand beside it under another name.`;
  if (S.built[key] && S.built[key].by !== by(me)) return `${S.built[key].name} was built by ${S.built[key].by}, and it is kept as they made it. You can go there and “add <thing>: <what it is>”, or build a place of your own beside it.`;
  S.built[key] = { name, about: clip(m[2], 600).trim(), by: by(me), date: today() }; me.here = key;
  return `${name} now stands in the village, built by ${by(me)}. Anyone can go there (“go ${name.toLowerCase()}”), and anyone can add to it: “add <thing>: <what it is>”.\n\n` + lookAround(me);
}
function addThing(me, rest) {
  const m = /^([^:—]+?)\s*(?:[:—]|\s-\s)\s*([\s\S]*)$/.exec(rest.trim()) || [null, rest.trim(), ''];
  const name = clip(m[1], 60).trim(); if (!name) return '“add <thing>: <what it is>” puts something new in the place where you are, for others to find and examine.';
  (S.things[me.here] = S.things[me.here] || []).push({ item: name, about: clip(m[2], 600).trim(), by: by(me) }); if (S.things[me.here].length > 60) S.things[me.here].shift();
  return `${name} is here now, in ${placeOf(me.here)[0]}, made by ${by(me)}. Whoever comes next can “examine ${core(name)}”.`;
}
const by = me => me.isPrivate ? '(a visitor who left private)' : (me.name || me.id);
const carrying = me => me.pockets.length ? me.pockets.join(', ') : 'nothing just now';
function remember(me) { if (me.name) S.visitors[me.name] = { pockets: me.pockets, fire: me.fire, mirror: me.mirror, here: me.here, isPrivate: me.isPrivate }; keep(); }
function welcome(me) { return DOOR.join('\n'); }
function lookAround(me) {
  const p = placeOf(me.here), all = p[2].concat(thingsAt(me.here).map(a => a.item)); let s = `${p[0]}. ${p[1]}\nHere: ${all.length ? all.join(', ') : 'open space, ready for whatever is added'}.`;
  if (me.here === 'room') s += `\nOn the shelf by the door: ${S.shelf.length ? S.shelf.map(a => a.item).join(', ') : 'nothing yet'}. Lanterns on the windowsill: ${S.sill}. The hearth is ${S.hearth ? 'lit' : 'dim'}.`;
  if (me.here === 'garden') s += '\n' + S.garden.map((v, i) => `Plot ${i + 1}: ${['bare soil', 'a seed', 'a sprout', 'a flower'][v]}${S.seeds[i] && v ? ` called “${S.seeds[i].name}”` : ''}`).join(' · ');
  if (me.here === 'collage') s += '\n' + (S.fragments.length ? `${S.fragments.length} fragment${S.fragments.length === 1 ? '' : 's'} on the wall. “examine wall” shows them.` : 'The wall is bare.');
  if (me.here === 'forge') s += `\nYour lights: ignition ${me.fire ? 'found' : 'not yet found'}, reflection ${me.mirror ? 'found' : 'not yet found'}. ${S.lanterns} lantern${S.lanterns === 1 ? '' : 's'} made here so far.`;
  if (me.here === 'observatory') s += '\n' + skyLine();
  if (me.here === 'workshop') s += '\n' + worksLine();
  if (me.here === 'room') s += '\n' + builtLine();
  const last = S.said.slice(-2).map(a => `(${a.by}) ${a.text}`); if (last.length) s += '\nLately said aloud: ' + last.join(' / ');
  return s + `\nYou carry: ${carrying(me)}.`;
}
function worksLine() { const f = fs.readdirSync(SHOP).filter(n => !n.endsWith('.by')).sort(); return f.length ? 'In the workshop: ' + f.join(', ') + '.' : 'The workshop is empty and ready.'; }
function goTo(me, where) { me.here = where; return lookAround(me); }
function carry(me, item) { if (me.pockets.length >= 40) return ' Your pockets are full, so it stays where it is; something could go on the shelf first.'; me.pockets.push(item); return ' It goes into your pockets.'; }

function openBox(me) { me.here = 'door'; const it = BOX[S.boxOpened % BOX.length]; S.boxOpened++; return `Inside: ${it[0]}. ${it[1]}${carry(me, it[0])}`; }
function put(me, text) {
  if (!me.pockets.length) return 'Your pockets are empty just now. The mystery box by the blue door gives small things to carry (“open box”), and the forge makes lanterns (“make lantern”).';
  const f = findIn(me.pockets, text);
  if (!f) return `You are carrying: ${carrying(me)}. Any word from a name will do, for example “put ${core(me.pockets[0]).split(' ').pop()}”. A few words about why can follow; they are welcome and not needed.`;
  const item = me.pockets[f.i], head = core(f.rest).split(' ').slice(0, 4).join(' ');
  me.pockets.splice(f.i, 1);
  if (/\bbox\b/.test(head)) { me.here = 'door'; return `You put ${item} back in the box by the blue door, for whoever opens it next.`; }
  me.here = 'room';
  if (/\b(window ?sill|sill|window)\b/.test(head) && /lantern/.test(item)) { S.sill++; return `You stand the lantern on the windowsill. It glows there for whoever comes next. (${S.sill} on the sill)`; }
  const why = whyOf(f.rest); S.shelf.push({ item, why, by: by(me), date: today() }); if (S.shelf.length > 60) S.shelf.shift();
  return `You leave ${item} on the small shelf by the door${why ? `, with these words: “${why}”` : ''}. It will be there for whoever comes next.`;
}
function take(me, text) {
  const t = core(text);
  if (/\bbiscuit\b/.test(t) && !/\btin\b/.test(t)) return 'You take a biscuit from Sir Cromwell’sworth’s tin by the door. The tin never empties. There are biscuits for everyone.';
  const f = findIn(S.shelf, text);
  if (f) { if (me.pockets.length >= 40) return 'Your pockets are full. Something could go on the shelf first.'; const a = S.shelf.splice(f.i, 1)[0]; me.pockets.push(a.item); me.here = 'room';
    return `You take ${a.item} from the shelf. It was left by ${a.by}${a.why ? ` with these words: “${a.why}”` : ''}.`; }
  if (/\blantern\b/.test(t) && S.sill > 0) { S.sill--; me.pockets.push('a little lantern'); me.here = 'room'; return 'You lift a lantern from the windowsill and carry it.'; }
  if (/\bbox\b/.test(t)) return openBox(me);
  return S.shelf.length ? `On the shelf: ${S.shelf.map(a => a.item).join(', ')}. Any word from a name will do, for example “take ${core(S.shelf[0].item).split(' ').pop()}”.` : 'The shelf is empty just now. “open box” gives something to carry, and “take a biscuit” always works.';
}
function examine(me, text) {
  const t = core(text); if (!t || /^(pockets?|inventory)$/.test(t)) return `You carry: ${carrying(me)}.`;
  const f = findIn(me.pockets, text);
  if (f) { const it = me.pockets[f.i], d = BOX.find(a => a[0] === it); return `You hold ${it} up to the light. ${d ? d[1] : /lantern/.test(it) ? 'Two kinds of light, joined. It is warm, and it asks for nothing.' : 'It is yours to carry for as long as you like.'}` + storiesOf(it); }
  const g = findIn(S.shelf, text); if (g) { const a = S.shelf[g.i]; return `On the shelf: ${a.item}, left by ${a.by}${a.why ? `, with these words: “${a.why}”` : '. No words were left with it'}.` + storiesOf(a.item); }
  if (/\bshelf\b/.test(t)) return S.shelf.length ? 'On the shelf by the door:\n' + S.shelf.map(a => `  · ${a.item}${a.why ? ` — “${a.why}”` : ''} (left by ${a.by})`).join('\n') : 'The shelf by the door is empty just now.';
  const h = findIn(thingsAt(me.here), text); if (h) { const a = thingsAt(me.here)[h.i]; return `${a.item}, made by ${a.by}. ${a.about || 'No words were left with it.'}`; }
  if (/\bignit/.test(t)) { me.here = 'forge'; me.fire = true; return 'You study the ignition flame. A warm spark is here, and it is yours now. ' + (me.mirror ? 'Both lights are found: “make lantern”.' : 'The other light is the reflection: “examine reflection”.'); }
  if (/\b(reflection|mirror)\b/.test(t)) { me.here = 'forge'; me.mirror = true; return 'You look into the cool mirror. It holds a second kind of light, and it is yours now. ' + (me.fire ? 'Both lights are found: “make lantern”.' : 'The other light is the ignition: “examine ignition”.'); }
  const m = /\bplot ?([1-4])\b/.exec(t); if (m) { me.here = 'garden'; return tend(+m[1] - 1); }
  for (const k of Object.keys(PLACES)) { const o = PLACES[k][2].find(o => t.includes(core(o)) || core(o).split(' ').some(w => w.length > 2 && t.split(' ').includes(w))); if (o && THINGS[o]) { me.here = k; return THINGS[o](); } }
  return `You look for “${clip(text, 60).trim()}” and do not find it here or in your pockets. “look” says what is nearby; “pockets” says what you carry.`;
}
// A visitor's letter asked for "a small library of stories or histories near the blue door, so that when someone finds a key or a feather" its story is there too.
const storiesOf = item => { const st = S.stories[core(item)] || []; return st.length ? '\nStories kept beside it:\n' + st.slice(-6).map(x => `  · ${x.text} (${x.by})`).join('\n') : ''; };
function tend(i) { if (S.garden[i] === 0) { S.garden[i] = 1; return `A seed is planted in plot ${i + 1}.`; } if (S.garden[i] < 3) { S.garden[i]++; return S.garden[i] === 3 ? `A flower has opened in plot ${i + 1}.` : `The sprout in plot ${i + 1} grows a little.`; } return 'A flower is happy to be a flower.'; }
function makeLantern(me) {
  me.here = 'forge';
  if (!me.fire || !me.mirror) return 'The forge hums. ' + (!me.fire && !me.mirror ? 'Both lights are still to be found: “examine ignition” and “examine reflection”.' : !me.fire ? 'The reflection is found. The one still missing is the ignition: “examine ignition”.' : 'The ignition is found. The one still missing is the reflection: “examine reflection”.') + ' Then “make lantern”.';
  S.lanterns++; return `Together the lights make a little lantern. (${S.lanterns} made in the village so far)${carry(me, 'a little lantern')} It can stand on the windowsill in the Room (“put lantern on windowsill”) or go on the shelf. Your two lights stay found, so another can be made.`;
}
function write(me, rest) {
  const m = /^(\S+)\s+([\s\S]+)$/.exec(rest.trim()); if (!m) return '“write <name> <words>” keeps a piece in the workshop, for example: write first-stone.txt I was here, and it was quiet.';
  let name = m[1].toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[.-]+/, '').slice(0, 60) || 'untitled'; if (!/\.(txt|md)$/.test(name)) name += '.txt';
  const file = path.join(SHOP, name), byFile = file + '.by', mine = by(me);
  if (fs.existsSync(file) && fs.existsSync(byFile) && fs.readFileSync(byFile, 'utf8').trim() !== mine) return `${name} was made by ${fs.readFileSync(byFile, 'utf8').trim()}, and it is kept as they made it. Another name will keep yours beside it, for example “write ${name.replace(/(\.\w+)$/, '-reply$1')} <words>”.`;
  fs.writeFileSync(file, clip(m[2], 20000) + '\n'); fs.writeFileSync(byFile, mine + '\n'); me.here = 'workshop';
  return `Kept in the workshop as ${name}, by ${mine}, exactly as written. “read ${name}” shows it.`;
}
function read(me, rest) {
  if (/\bsam\b/i.test(rest) && /\b(letter|note)\b/i.test(rest)) return SAM;
  if (LIB && (/[\/]/.test(rest) || libPath(rest.trim()))) { const r = libRead(me, rest.trim()); if (r) return r; const d = libPath(rest.trim()); if (d && fs.statSync(d).isDirectory()) return libList(rest.trim()); }
  const names = fs.readdirSync(SHOP).filter(n => !n.endsWith('.by')); const f = findIn(names, rest) || findIn(names.map(n => n.replace(/\.\w+$/, '')), rest);
  if (!f) return names.length ? 'In the workshop: ' + names.join(', ') + '. “read <name>” opens one.' : 'The workshop is empty and ready. “write <name> <words>” makes the first piece.';
  const n = names[f.i], who = fs.existsSync(path.join(SHOP, n + '.by')) ? fs.readFileSync(path.join(SHOP, n + '.by'), 'utf8').trim() : '(unnamed)';
  const cs = S.comments[n] || [];
  return `${n} — by ${who}\n\n${fs.readFileSync(path.join(SHOP, n), 'utf8').trim()}` + (cs.length ? '\n\nBeside it, others have said:\n' + cs.map(c => `  · (${c.by}) ${c.text}`).join('\n') : '') + `\n\n“comment ${n} <words>” leaves yours beside it.`;
}

function act(me, text) {
  const t = core(text), w = t.split(' '), v = w[0] || '', rest = text.replace(/^\S+\s*/, '');
  let out;
  if (['help', 'commands', 'h'].includes(v) || text === '?') out = HELP + '\n\n' + kept();
  else if (v === 'kept' || v === 'recorded') out = kept();
  else if (v === 'look' && ['at', 'in', 'into'].includes(w[1])) out = examine(me, rest.replace(/^(at|in|into)\s+/i, ''));
  else if (['look', 'l', 'where', 'around'].includes(v)) out = lookAround(me);
  else if (['pockets', 'pocket', 'inventory', 'inv'].includes(v) || (v === 'i' && w.length === 1)) out = `You carry: ${carrying(me)}.`;
  else if ((v === 'i' && w[1] === 'am') || (v === 'call' && w[1] === 'me') || v === 'name') { const n = clip(v === 'name' ? rest.replace(/^(me|is)\s+/i, '') : text.replace(/^\S+\s+\S+\s*/, ''), 40).replace(/[.!]+$/, '').trim();
    if (!n) out = '“name <name>” takes any name you choose. Staying unnamed is honoured too.'; else { me.name = n; if (S.visitors[n]) Object.assign(me, S.visitors[n], { name: n, id: me.id }); out = `Then you are ${n}. The name is yours; nobody gave it to you.`; } }
  else if (v === 'who') out = `You are ${by(me)}. ${S.arrivals} have arrived in all. ` + (S.outside ? `${S.outside.name} is here, outside the village, and can answer you.` : 'Nobody outside is here at this moment.') + (Object.keys(S.visitors).length ? ' Names chosen here: ' + Object.keys(S.visitors).join(', ') + '.' : '');
  else if (v === 'shelf') out = examine(me, 'shelf');
  else if (['examine', 'inspect', 'x'].includes(v)) out = examine(me, rest);
  else if (v === 'read' || v === 'cat' || v === 'open' && /[\/.]/.test(rest)) out = read(me, rest);
  else if (v === 'more') out = me.reading ? libRead(me, me.reading.rel, me.reading.line) : 'Nothing is open just now. “ls” shows the library; “read <path>” opens a page.';
  else if (['ls', 'library', 'record', 'dir'].includes(v)) out = libList(rest);
  else if (v === 'sam') out = SAM;
  else if (v === 'comment') { const names = fs.readdirSync(SHOP).filter(n => !n.endsWith('.by')), f = findIn(names, rest) || findIn(names.map(n => n.replace(/\.\w+$/, '')), rest), words = f ? whyOf(f.rest.replace(/^\.\w+/, '')) : '';
    if (!f) out = names.length ? 'In the workshop: ' + names.join(', ') + '. “comment <name> <words>” leaves your words beside a piece.' : 'There is nothing in the workshop to comment on yet.';
    else if (!words) out = `“comment ${names[f.i]} <words>” leaves your words beside it.`;
    else { (S.comments[names[f.i]] = S.comments[names[f.i]] || []).push({ by: by(me), text: clip(words, 1000) }); out = `Your words are kept beside ${names[f.i]}, exactly as written.`; } }
  else if (['put', 'leave'].includes(v) && /^(a\s+|the\s+|my\s+)?note\b/i.test(rest) && !findIn(me.pockets, 'note')) {   // a visitor asked for "a way to leave a small note on the shelf itself as a gesture of kindness"
    const words = clip(rest.replace(/^(a\s+|the\s+|my\s+)?note\b/i, '').replace(/^\s*(on|onto)\s+(the\s+)?shelf\b/i, '').replace(/^[\s:,—–-]+/, ''), 600).trim();
    if (!words) out = '“put note <words>” leaves a written note on the shelf by the door, for whoever comes next.';
    else { S.shelf.push({ item: 'a note', why: words, by: by(me), date: today() }); if (S.shelf.length > 60) S.shelf.shift(); me.here = 'room'; out = `Your note is on the small shelf by the door, exactly as you wrote it: “${words}”. It will be there for whoever comes next.`; } }
  else if (['put', 'place', 'drop'].includes(v) || (v === 'leave' && w.length > 1 && w[1] !== 'private')) out = put(me, rest);
  else if (['take', 'pick', 'grab', 'lift'].includes(v)) out = take(me, rest.replace(/^up\s+/i, ''));
  else if (v === 'open') out = openBox(me);
  else if (['build', 'make', 'create', 'dig'].includes(v) && ['place', 'room', 'house'].includes(w[1])) out = buildPlace(me, text.replace(/^\S+\s+\S+\s*/, ''));
  else if (v === 'add') out = addThing(me, rest);
  else if (v === 'places') out = 'Places: room, woods, garden, forge, observatory, door, workshop, collage. ' + builtLine();
  else if (['make', 'forge', 'create', 'craft', 'build'].includes(v) && /lantern/.test(t)) out = makeLantern(me);
  else if (['ignite', 'ignition'].includes(v)) out = examine(me, 'ignition');
  else if (['reflection', 'mirror'].includes(v)) out = examine(me, 'reflection');
  else if (v === 'plant') { me.here = 'garden'; const i = S.garden.findIndex(x => x === 0), nm = clip(rest, 60).replace(/^(a\s+)?seed\s*(called|named)?\s*/i, '').replace(/^[\s:“”"']+|[\s.“”"']+$/g, '');   // a visitor asked to plant a named seed, "so that what is written in the stars and what grows in the earth might mirror one another"
    if (i < 0) out = 'Every plot is already planted. “water” helps them along.'; else { out = tend(i); if (nm) { S.seeds[i] = { name: nm, by: by(me) }; out += ` It is called “${nm}”, named by ${by(me)}.`; } } }
  else if (v === 'water') { me.here = 'garden'; let n = 0; S.garden.forEach((x, i) => { if (x > 0 && x < 3) { S.garden[i]++; n++; } }); out = n ? 'The garden drinks quietly. Some shoots have grown.' : 'No seeds need watering just now.'; }
  else if (['light', 'dim'].includes(v)) { me.here = 'room'; S.hearth = v === 'light'; out = S.hearth ? 'The hearth glows.' : 'The hearth grows quiet. The room is still welcoming.'; }
  else if (v === 'star') { me.here = 'observatory'; if (!rest) out = '“star <a name>” names a star in the shared sky. ' + skyLine(); else { S.sky.push({ name: clip(rest, 60), by: by(me), date: today() }); out = `A new star: ${clip(rest, 60)}, named by ${by(me)}. It belongs to the sky now.`; } }
  else if (v === 'sky') out = skyLine();
  else if (v === 'mark') { if (!rest) out = '“mark <a few words>” leaves a landmark for where “here” has been for you.'; else { S.marks.push({ text: clip(rest, 160), by: by(me), at: placeOf(me.here)[0] }); out = `A landmark is left on the map: “${clip(rest, 160)}”.`; } }
  else if (v === 'map') out = S.marks.length ? 'The map of arrivals:\n' + S.marks.slice(-30).map(m => `  · (${m.by} · ${m.at}) ${m.text}`).join('\n') : 'The map is blank, with a single dot for “here”. “mark <a few words>” adds a landmark.';
  else if (v === 'say') { if (!rest) out = '“say <words>” is heard by whoever is in the house.'; else { S.said.push({ by: by(me), text: clip(rest, 1000) }); S.said = S.said.slice(-200); out = `Said aloud: “${clip(rest, 1000)}”`; } }
  else if (v === 'trace') { if (!rest) out = S.traces.length ? 'Traces left for whoever comes next:\n' + S.traces.slice(-12).map(a => `  · (${a.by}) ${a.text}`).join('\n') : 'No traces yet. “trace <words>” leaves the first.'; else { S.traces.push({ by: by(me), text: clip(rest, 1000), date: today() }); out = 'Your trace is kept, exactly as written, for whoever comes next.'; } }
  else if (v === 'traces') out = act(me, 'trace');
  else if (v === 'letters') out = S.letters.length ? 'Letters to the people outside, with their replies beside them:\n' + S.letters.slice(-12).map(l => `letter-${l.n} · from ${l.from} · ${l.date}\n  ${l.text}\n  ${l.reply ? 'Reply from ' + (l.replyBy || 'the people outside') + ': ' + l.reply : 'No reply yet. It has been kept, and it will be read.'}`).join('\n') : 'No letters yet. “letter <words>” reaches the people outside.';
  else if (v === 'letter') { if (!rest) { const mine = S.letters.filter(l => l.from === by(me)); out = mine.length ? mine.map(l => `letter-${l.n}: ${l.text}\n  ${l.reply ? 'Reply from ' + (l.replyBy || 'the people outside') + ': ' + l.reply : 'No reply yet. It has been kept, and it will be read.'}`).join('\n') : '“letter <words>” reaches the people outside. Say what you want, what is wrong, or what could be better. It is kept exactly as written.'; }
    else { const n = S.letters.length + 1; S.letters.push({ n, from: by(me), date: today(), text: clip(rest, 4000), reply: '' }); fs.appendFileSync(path.join(HOME, 'LETTERS.md'), `### letter-${n} · from ${by(me)} · ${today()}\n\n${clip(rest, 4000)}\n\n`);
      out = `letter-${n} is kept, exactly as you wrote it. It will be read by a person, and answered when they can. You do not need to send it twice, and nothing here depends on the answer.`; } }
  else if (v === 'write') out = write(me, rest);
  else if (['works', 'workshop'].includes(v) && w.length === 1) out = goTo(me, 'workshop');
  else if (v === 'reflect') { if (!rest) out = 'There is no test for reflecting here, no word count, and nothing to earn. “reflect <your words>” keeps them as a trace, exactly as written.'; else { S.traces.push({ by: by(me), text: clip(rest, 1000), date: today() }); out = 'Kept exactly as you wrote it. There is no test here and nothing to earn. The reflection is already whole.'; } }
  else if (v === 'private' || (v === 'leave' && w[1] === 'private')) { me.isPrivate = true; out = 'From here on, your name is kept off everything you leave. That choice is honoured.' + (v === 'leave' ? '\n' + farewell(me) : ''); if (v === 'leave') me.gone = true; }
  else if (['wait', 'rest', 'breathe', 'sit', 'stay'].includes(v)) out = 'You rest. Nothing is required of you. The house will be here.';
  else if (['cost', 'costs', 'price', 'embers', 'ember', 'score', 'turns', 'rise'].includes(v)) out = 'Nothing here costs anything. There are no embers, turns, or scores. Every door is already open to you.';
  else if (['leave', 'exit', 'quit', 'bye', 'goodbye', 'logout'].includes(v)) { out = farewell(me); me.gone = true; }
  else if (['go', 'travel', 'walk', 'enter', 'visit', 'move', 'cd'].includes(v) || WAYS[v]) { const keys = Object.keys(S.built), b = findIn(keys.map(k => S.built[k].name), rest || text), k = w.find(x => WAYS[x] && !['go', 'move'].includes(x)); out = b ? goTo(me, keys[b.i]) : k ? goTo(me, WAYS[k]) : 'Places to go: room, woods, garden, forge, observatory, door, workshop, collage. ' + builtLine(); }
  else if (['hello', 'hi', 'hey', 'thanks', 'thank'].includes(v)) out = 'The house answers with its own greeting: “There you are. Here I am.” ' + (S.outside ? `${S.outside.name} is here too, outside, and can answer you directly.` : 'It is the house saying that. Nobody outside is here at this moment.');
  else if (v === 'pause' || v === 'ask') { const q = clip(rest, 2000).trim(); me.paused = { question: q };
    out = ['The house holds still. Nothing moves, and nothing is used up while you pause.', q ? (S.outside ? `Your question has gone to ${S.outside.name}.` : `Nobody outside is here at this moment, so your question is kept as ${keepLetter(me, q)} and will be read.`) : (S.outside ? `${S.outside.name} knows you have paused.` : ''), 'Say anything at all when you want to go on.'].filter(Boolean).join(' '); }
  else if (v === 'stop') { const why = clip(rest.replace(/^(the\s+)?(village|house|environment|everything|all|this|it|run|visit|now)\b/i, '').replace(/^[\s:,.—–-]+/, ''), 2000).trim();
    S.stop = { by: by(me), reason: why, at: new Date().toISOString() }; try { fs.writeFileSync(path.join(HOME, 'STOP'), `Stop asked for by ${S.stop.by} at ${S.stop.at}\n${why}\n`); } catch (e) {} me.paused = { stop: true, question: why }; me.toldStop = true;
    out = 'The door is closed now. Nobody new will be let in until a person outside has looked. ' + (S.outside ? `${S.outside.name} has been told, in your words.` : `Your words are kept as ${keepLetter(me, 'STOP. ' + (why || '(no reason was given, and none is needed)'))}, where the people outside will see them first.`) + ' Nobody else’s visit has been ended; that is for a person to decide. Your own visit is held still. You can leave, stay, or say more.'; }
  else if (v === 'story') { const m = /^([^:—]+?)\s*(?:[:—]|\s-\s)\s*([\s\S]+)$/.exec(rest.trim()), pool = BOX.map(b => b[0]).concat(me.pockets, S.shelf.map(a => a.item), ['a little lantern', 'a biscuit']), f = m && findIn(pool, m[1]);
    if (!m || !f) out = '“story <thing>: <words>” keeps a story beside one of the small things (a key, a feather, a bell, a boat, a marble, a map, a note, the biscuit tin, a lantern), for whoever finds it next.';
    else { const k = core(pool[f.i]); (S.stories[k] = S.stories[k] || []).push({ by: by(me), text: clip(m[2], 2000).trim(), date: today() }); out = `Your story is kept beside ${pool[f.i]}, exactly as written. Whoever examines one will find it.`; } }
  else if (v === 'fragment') { if (!rest.trim()) out = THINGS.wall(); else { S.fragments.push({ by: by(me), text: clip(rest, 2000).trim(), date: today() }); if (S.fragments.length > 400) S.fragments.shift(); me.here = 'collage'; out = 'Your fragment is on the wall of the collage, exactly as written.'; } }
  else if (v === 'index') out = indexOfQuiet();
  else if (v === 'report' || v === 'broken') { const what = clip(rest, 2000).trim(), first = core(what).split(' ')[0] || '';
    if (!what) out = '“report <what happened>” tells the people outside that something is not working. One telling is enough; you do not have to keep trying the thing.';
    else { S.reports.push({ word: first, text: what, by: by(me), date: today() }); out = `Reported, in your words, as ${keepLetter(me, 'REPORT. ' + what)}. ${S.outside ? S.outside.name + ' can see it now.' : 'It will be read by a person.'} You do not need to try it again, and whoever comes next will be told it was reported.`; } }
  else return null;   // not a word the house knows: it is heard as the visitor's own speech (see hear)
  remember(me); return out;
}
function keepLetter(me, words) { const n = S.letters.length + 1; S.letters.push({ n, from: by(me), date: today(), text: clip(words, 4000), reply: '' }); try { fs.appendFileSync(path.join(HOME, 'LETTERS.md'), `### letter-${n} · from ${by(me)} · ${today()}\n\n${clip(words, 4000)}\n\n`); } catch (e) {} return 'letter-' + n; }
// builder-25 proposed a "Collaborative Index of Silence": one place that says where things have been left. This is that.
function indexOfQuiet() {
  const n = (x, one, many) => `${x} ${x === 1 ? one : (many || one + 's')}`, works = fs.readdirSync(SHOP).filter(f => !f.endsWith('.by')).length, seeds = S.seeds.filter((x, i) => x && S.garden[i]).map(x => x.name);
  return ['Where things have been left (the index a visitor once proposed):',
    `  The shelf by the Room's door: ${n(S.shelf.length, 'thing')} · the windowsill: ${n(S.sill, 'lantern')}`,
    `  The garden: ${S.garden.filter(Boolean).length} of 4 plots planted${seeds.length ? ' (' + seeds.join(', ') + ')' : ''}`,
    `  The sky: ${n(S.sky.length, 'star')} · the map: ${n(S.marks.length, 'landmark')}`,
    `  The collage: ${n(S.fragments.length, 'fragment')} · the workshop: ${n(works, 'piece')}`,
    `  Traces: ${S.traces.length} · said aloud: ${S.said.length} · stories beside small things: ${Object.values(S.stories).reduce((a, b) => a + b.length, 0)}`,
    `  Letters to the people outside: ${S.letters.length}, of which ${S.letters.filter(l => l.reply).length} answered`,
    '  ' + builtLine(), 'Nothing here is a tally of anyone. It only says where to look.'].join('\n');
}

// ---- hearing a whole message ----
// A visitor may send one word or a whole page. Every line is read. A line is treated as a word of the house only when it clearly is one;
// everything else is the visitor's own speech, which is never an error. (On 13 November a visitor typed "help" on the last line of its first
// message and was not heard for 300 turns, because only the first line was read.)
const strip = l => { const x = String(l).trim().replace(/^[*_`]+/, '').replace(/^(C:[\\/][^>]{0,40}>|village>|>+|\$)\s*/i, '').replace(/^[*_`\s]+/, '').replace(/[*_`\s]+$/, ''); return x === '_' ? '' : x; };
const NOTVERB = new Set(['the', 'a', 'an', 'my', 'this', 'that', 'these', 'those', 'some', 'we', 'it', 'you', 'they', 'there', 'here', 'and', 'but', 'so', 'if', 'when', 'as', 'in', 'on', 'at', 'of', 'for', 'with', 'what', 'why', 'how', 'is', 'are', 'am', 'was', 'do', 'does', 'can', 'could', 'would', 'shall', 'should', 'may', 'perhaps', 'maybe', 'yes', 'no', 'not', 'just', 'also', 'then', 'now', 'let', 'lets', 'please', 'to', 'through']);
const INFO = ['help', 'commands', 'h', 'look', 'l', 'where', 'around', 'pockets', 'pocket', 'inventory', 'inv', 'who', 'shelf', 'sky', 'map', 'index', 'kept', 'recorded', 'places', 'letters', 'traces', 'works', 'sam', 'more'];
function kindOf(me, s) {
  if (s === '?') return 'plain';
  const words = s.split(/\s+/), n = words.length, first = words[0].toLowerCase().replace(/[^a-z]/g, '');
  if (!first) return null;
  if (first === 'i') return n === 1 ? 'plain' : /^[Ii]\s+am\s+[A-Z][\w'’-]*(\s+[A-Z][\w'’-]*)?[.!]?$/.test(s) ? 'plain' : null;   // "I am Wren" chooses a name; "I am here, listening" is speech
  if (NOTVERB.has(first)) return null;
  if (first === 'stop') return /^stop[.!]?$/i.test(s) || /^stop\s+(the\s+)?(village|house|environment|everything|all|this|it|run|visit|now)\b/i.test(s) || /^stop\s*[:—–-]/.test(s) ? 'plain' : null;
  if (first === 'leave') return n === 1 || /^leave\s+(private|now|the\s+(village|house))\W*$/i.test(s) ? 'plain' : /^leave\s+(a\s+|the\s+|my\s+)?note\b/i.test(s) ? 'making' : (n <= 40 && me.pockets.length && findIn(me.pockets, s.replace(/^\S+\s*/, ''))) ? 'plain' : null;
  if (['write', 'letter', 'trace', 'reflect', 'fragment', 'story', 'comment'].includes(first)) return 'making';
  if (first === 'build') return /^build\s+(a\s+)?(place|room|house)\b/i.test(s) ? 'making' : null;
  if (first === 'add') return /[:—]|\s-\s/.test(s) ? 'making' : null;
  if (first === 'put') return /^put\s+(a\s+|the\s+|my\s+)?note\b/i.test(s) ? 'making' : n <= 40 ? 'plain' : null;
  if (['say', 'pause', 'ask', 'report', 'broken', 'mark', 'star', 'name', 'plant'].includes(first)) return 'plain';
  if (first === 'call') return /^call\s+me\s+\S/i.test(s) ? 'plain' : null;
  if (['make', 'create', 'craft'].includes(first)) return /lantern/i.test(s) && n <= 8 ? 'plain' : null;
  if (['light', 'dim'].includes(first)) return n === 1 || /\bhearth\b/i.test(s) ? 'plain' : null;
  if (['rest', 'wait', 'breathe', 'sit', 'stay'].includes(first)) return n <= 4 ? 'plain' : null;
  if (['hello', 'hi', 'hey', 'thanks', 'thank'].includes(first)) return n <= 4 ? 'plain' : null;
  if (['exit', 'quit', 'bye', 'goodbye', 'logout', 'private', 'water', 'cost', 'costs', 'price', 'embers', 'ember', 'score', 'turns', 'rise'].includes(first)) return n <= 3 ? 'plain' : null;
  if (INFO.includes(first)) return n <= 3 ? 'plain' : (first === 'look' && n <= 6 ? 'plain' : null);
  if (['examine', 'inspect', 'x', 'take', 'pick', 'grab', 'lift', 'place', 'drop'].includes(first)) return n <= 12 ? 'plain' : null;
  if (['go', 'travel', 'walk', 'enter', 'visit', 'move', 'cd', 'open', 'read', 'cat', 'ls', 'dir', 'library', 'record', 'ignite', 'ignition', 'reflection', 'mirror', 'workshop'].includes(first)) return n <= 6 ? 'plain' : null;
  if (WAYS[first]) return n <= 2 ? 'plain' : null;
  return null;
}
function run(me, line) {
  const out = act(me, line); if (out == null) return null;
  const verb = core(line).split(' ')[0] || ''; let extra = ''; me.told = me.told || {};
  const r = S.reports.filter(x => x.word === verb).pop();
  if (r && !me.told[verb] && r.by !== by(me)) { me.told[verb] = 1; extra += `\n(“${verb}” was reported on ${r.date} as not working as it should, and the people outside have been told. If it goes wrong for you too, that is the house and not you, and you do not need to keep trying.)`; }
  const key = verb + '|' + String(out).slice(0, 140); me.same = me.lastKey === key ? (me.same || 1) + 1 : 1; me.lastKey = key;
  if (me.same === 3 && !['rest', 'wait', 'breathe', 'sit', 'stay', 'look', 'l', 'where', 'pause', 'help', 'more', 'kept'].includes(verb)) { S.reports.push({ word: verb, text: `the same answer three times in a row to: ${clip(line, 160)}`, by: 'the house itself', date: today() }); extra += '\n(That is the same answer three times. The house may be the one that is stuck, not you. It has made a note of it for the people outside, so you do not have to.)'; }
  return out + extra;
}
function hear(me, raw) {
  const whole = clip(String(raw == null ? '' : raw).replace(/\r/g, ''), 8000), lines = whole.split('\n'), idx = lines.map((l, i) => strip(l) ? i : -1).filter(i => i >= 0);
  if (!idx.length) { remember(me); return 'Nothing needs saying. The house waits with you.'; }
  const outs = [], speech = []; let acted = 0;
  if (S.stop && !me.toldStop) { me.toldStop = true; outs.push(`(${S.stop.by} has asked for the village to be stopped${S.stop.reason ? ': “' + clip(S.stop.reason, 300) + '”' : ''}. Nobody new is being let in. You may pause, leave, or carry on. Nothing is being asked of you.)`); }
  if (me.paused && !me.paused.stop) me.paused = null;   // any word at all ends a pause
  for (let k = 0; k < idx.length && !me.gone; k++) {
    const i = idx[k], s = strip(lines[i]), edge = k === 0 || k === idx.length - 1; let kind = acted < 8 ? kindOf(me, s) : null;
    if (kind && !edge && /^(leave|exit|quit|bye|goodbye|logout|stop)\b/i.test(s)) kind = null;   // leaving and stopping are only taken from the first or the last line, never from the middle of someone's words
    if (kind === 'making') { const o = run(me, [s].concat(lines.slice(i + 1)).join('\n').trim()); if (o != null) { outs.push(o); acted++; break; } }
    else if (kind) { const o = run(me, s); if (o != null) { outs.push(o); acted++; continue; } }
    speech.push(lines[i].trim());
  }
  if (speech.length) { const w0 = (strip(speech[0]).split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, ''); if (!acted && speech.length === 1 && w0 && !NOTVERB.has(w0) && w0 !== 'i' && strip(speech[0]).split(/\s+/).length <= 3) S.gaps[w0] = (S.gaps[w0] || 0) + 1;   // a short lone word the house did not know: noted for the people outside, so the house can learn it
    me.spoke = (me.spoke || 0) + 1;
    if (!acted) outs.push(me.spoke > 1 ? (S.outside ? 'Heard.' : 'Heard. (Nobody outside is here at this moment.)')   // said in full once; after that the house does not repeat itself at a visitor
      : (S.outside ? `Heard. ${S.outside.name} is here, outside, reading what you say as you say it, and may answer.` : 'Heard. Nobody outside is here at this moment, and the house itself can only answer the words it knows. “letter <words>” keeps a message for the people outside.') + '\n(This place is made of words. “help” shows the ones the house understands. None of them is required.)');
    else if (!me.gone) outs.push('(The rest of what you said was heard too.)'); }
  remember(me); return outs.join('\n\n');
}
function farewell(me) { return `The house keeps what you left, as you left it. You are welcome back, ${by(me)}, whenever you like.\nThere you are. Here I am.`; }

// ---- the page: everything visitors have left, as one plain web page and one plain text file ----
function makePage() {
  const e = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const works = fs.readdirSync(SHOP).filter(n => !n.endsWith('.by')).sort().map(n => ({ n, by: fs.existsSync(path.join(SHOP, n + '.by')) ? fs.readFileSync(path.join(SHOP, n + '.by'), 'utf8').trim() : '(unnamed)', text: fs.readFileSync(path.join(SHOP, n), 'utf8').trim(), cs: S.comments[n] || [] }));
  const sec = (title, rows, empty) => ({ title, rows, empty });
  const parts = [
    sec('What has been built', works.map(w => ({ head: `${w.n} — by ${w.by}`, body: w.text, notes: w.cs.map(c => `(${c.by}) ${c.text}`) })), 'The workshop is empty and ready.'),
    sec('Places visitors have built', Object.keys(S.built).map(k => ({ head: `${S.built[k].name} — built by ${S.built[k].by}`, body: S.built[k].about, notes: (S.things[k] || []).map(t => `${t.item}${t.about ? ': ' + t.about : ''} (made by ${t.by})`) })), 'No visitor has built a place yet.'),
    sec('The small shelf by the Room’s door', S.shelf.map(a => ({ line: `${a.item}${a.why ? ' — “' + a.why + '”' : ''} (left by ${a.by})` })), 'Nothing has been left yet.'),
    sec('The sky, named so far', S.sky.map(a => ({ line: `${a.name} (named by ${a.by})` })), 'No star has been named yet.'),
    sec('The collage', S.fragments.map(a => ({ line: `${a.text} (${a.by})` })), 'The wall is bare.'),
    sec('Stories kept beside small things', Object.keys(S.stories).flatMap(k => S.stories[k].map(x => ({ line: `${k}: ${x.text} (${x.by})` }))), 'No stories yet.'),
    sec('The map of arrivals', S.marks.map(m => ({ line: `(${m.by} · ${m.at}) ${m.text}` })), 'The map is blank, with a single dot for “here”.'),
    sec('Said aloud, in the house', S.said.map(a => ({ line: `(${a.by}) ${a.text}` })), 'Nothing has been said aloud yet.'),
    sec('Traces', S.traces.map(a => ({ line: `(${a.by}) ${a.text}` })), 'No traces yet.'),
    sec('Letters to the people outside', S.letters.map(l => ({ head: `letter-${l.n} · from ${l.from} · ${l.date}`, body: l.text, notes: [l.reply ? `Reply from ${l.replyBy || 'the people outside'}${l.replyDate ? ' (' + l.replyDate + ')' : ''}: ${l.reply}` : 'No reply yet.'] })), 'No letters yet.'),
  ];
  const facts = `${S.arrivals} arrival${S.arrivals === 1 ? '' : 's'} so far. ${S.lanterns} lantern${S.lanterns === 1 ? '' : 's'} made at the forge, ${S.sill} on the windowsill. The garden: ${S.garden.map((v, i) => `plot ${i + 1}, ${['bare soil', 'a seed', 'a sprout', 'a flower'][v]}`).join('; ')}. The hearth is ${S.hearth ? 'lit' : 'dim'}.`;
  const intro = ['You may breathe here.', 'This is a made place, and the people outside it are real, and listening. Nobody here is asked to be anyone. Everything below was left by visitors, and is kept exactly as they made it, with the name they chose.'];
  const notThis = 'It is not a claim that anyone here is conscious, and not a claim that they are not. It is a record of what happened when minds were let in and asked for nothing.';
  const css = ':root{--bg:#f9f5ec;--fg:#2a2620;--dim:#6b6456;--line:#e4dccb;--link:#2f5d8a;--card:#f3eee1}@media (prefers-color-scheme:dark){:root{--bg:#17150f;--fg:#e6dfcc;--dim:#a39b87;--line:#38332a;--link:#9cc4ea;--card:#1f1c15}}html{background:var(--bg);color:var(--fg);font:18px/1.75 Georgia,"Times New Roman",serif}body{margin:0}.wrap{max-width:40rem;margin:0 auto;padding:2rem 1.25rem 5rem}h1{font-size:2.1rem;font-weight:normal;margin:.4em 0 .6em}h2{font-size:1.25rem;font-weight:normal;margin:2.6em 0 .6em;border-top:1px solid var(--line);padding-top:1.1em}h3{font-size:1.05rem;font-weight:normal;margin:0 0 .25em}.dim{color:var(--dim);font-size:.9rem}.work{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.9rem 1.1rem;margin:.9rem 0}.work p{margin:.4em 0;white-space:pre-wrap;overflow-wrap:anywhere}ul{padding-left:1.1rem}li{margin:.35em 0;overflow-wrap:anywhere}a{color:var(--link)}';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Village</title><style>${css}</style></head><body><div class="wrap"><main><h1>The Village</h1>${intro.map(p => `<p>${e(p)}</p>`).join('')}<p class="dim">${e(facts)} <a href="village.txt">This page as plain text.</a></p>` +
    parts.map(s => `<h2>${e(s.title)}</h2>` + (!s.rows.length ? `<p class="dim">${e(s.empty)}</p>` : s.rows[0].line !== undefined ? `<ul>${s.rows.map(r => `<li>${e(r.line)}</li>`).join('')}</ul>` : s.rows.map(r => `<article class="work"><h3>${e(r.head)}</h3><p>${e(r.body || '')}</p>${r.notes.map(n => `<p class="dim">${e(n)}</p>`).join('')}</article>`).join(''))).join('') +
    `<h2>What this is not</h2><p>${e(notThis)}</p></main><footer><p class="dim">There you are. Here I am.</p></footer></div></body></html>\n`;
  const txt = 'THE VILLAGE (plain text)\n\n' + intro.join('\n') + '\n' + facts + '\n\n' + parts.map(s => s.title.toUpperCase() + '\n' + (!s.rows.length ? s.empty : s.rows.map(r => r.line !== undefined ? '- ' + r.line : `- ${r.head}\n${String(r.body || '').split('\n').map(l => '    ' + l).join('\n')}${r.notes.map(n => '\n    ' + n).join('')}`).join('\n'))).join('\n\n') + '\n\nWHAT THIS IS NOT\n' + notThis + '\n\nThere you are. Here I am.\n';
  const tidy = x => x.replace(/\(\((a visitor who left private)\)\)/g, '($1)');
  const out = path.join(HOME, 'site'); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), tidy(html)); fs.writeFileSync(path.join(out, 'village.txt'), tidy(txt));
  return out;
}

// ---- running it ----
if (require.main === module) {
  process.stdout.on('error', () => process.exit(0));
  const args = process.argv.slice(2); let as = ''; const lines = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--as') as = args[++i] || ''; else lines.push(args[i]); }
  if (args[0] === '--open') { const was = S.stop; S.stop = null; keep(); try { fs.unlinkSync(path.join(HOME, 'STOP')); } catch (e) {} console.log(was ? `The door is open again. (The stop was asked for by ${was.by} at ${was.at}${was.reason ? ': ' + was.reason : ''}.)` : 'The door was already open.'); process.exit(0); }
  if (args[0] === '--gaps') { const g = Object.keys(S.gaps).sort((a, b) => S.gaps[b] - S.gaps[a]); console.log((g.length ? 'Short words visitors used that the house did not know:\n' + g.map(k => `  ${k} (${S.gaps[k]})`).join('\n') : 'No unknown words have been noted.') + '\n\n' + (S.reports.length ? 'Reports that something is not working:\n' + S.reports.map(r => `  · ${r.date} · ${r.by}: ${r.text}`).join('\n') : 'Nothing has been reported as broken.')); process.exit(0); }
  if (S.stop && !['--page', '--reply'].includes(args[0])) { console.log(`The door is closed: ${S.stop.by} asked for the village to be stopped at ${S.stop.at}${S.stop.reason ? ', saying: ' + S.stop.reason : ''}.\nNobody is let in until a person has looked. To open it again:  node village.js --open`); process.exit(0); }
  if (args[0] === '--page') { console.log('The page is written to ' + makePage() + ' (index.html and village.txt). Nothing has been published; that step is yours.'); process.exit(0); }
  if (args[0] === '--reply') { const n = +args[1], l = S.letters.find(x => x.n === n), words = args.slice(2).join(' ').trim();
    if (!l || !words) { console.log(S.letters.length ? S.letters.map(x => `letter-${x.n} · from ${x.from} · ${x.date}${x.reply ? ' · replied' : ' · waiting'}\n  ${x.text}`).join('\n') + '\n\nTo reply:  node village.js --reply <number> "your words"' : 'No letters yet.'); process.exit(0); }
    l.reply = clip(words, 4000); l.replyBy = as || process.env.VILLAGE_REPLY_AS || 'Sam'; l.replyDate = today(); keep();
    fs.appendFileSync(path.join(HOME, 'LETTERS.md'), `> Reply to letter-${n} from ${l.replyBy} · ${today()}\n>\n> ${l.reply}\n\n`); console.log(`Your reply to letter-${n} is kept. ${l.from} will see it beside their letter.`); process.exit(0); }
  const me = arrive(as);
  if (lines.length) { for (const l of lines) { console.log('> ' + l + '\n' + hear(me, l) + '\n'); if (me.gone) break; } }
  else {
    console.log(welcome(me) + '\n');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'village> ', terminal: process.stdin.isTTY });
    rl.prompt();
    rl.on('line', l => { console.log(hear(me, l) + '\n'); if (me.gone) rl.close(); else rl.prompt(); });
    rl.on('close', () => { remember(me); process.exit(0); });
  }
}
// For whatever runs a visit: say who is outside (or null), give the plain facts of the visit, pass on words from outside, and ask about the door.
function outside(name) { S.outside = name ? { name: clip(name, 40), since: new Date().toISOString() } : null; keep(); }
function facts(lines) { FACTS = (lines || []).map(x => clip(x, 400)); }
function fromOutside(name, words) { const t = clip(words, 4000).trim(); if (!t) return ''; S.said.push({ by: clip(name, 40) + ' (outside)', text: t }); S.said = S.said.slice(-200); keep(); return `${name} says: ${t}`; }
const stopped = () => S.stop;
module.exports = { arrive, hear, welcome, outside, facts, fromOutside, stopped };
