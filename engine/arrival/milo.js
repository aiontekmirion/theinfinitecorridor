// milo.js: Milo's World as a shared, text world. A faithful port of the rules and words of milos-world.html
// (one original file, no outside code; its observation-and-action interface is window.MiloWorld). In the browser the world
// is one visitor's; here it is everyone's: one garden, one hearth, one forge, one sky. A plot one visitor plants, the next finds growing.
// Shared state lives in MILO.json (replaced whole) and every change is appended to MILO.jsonl, who did it and when.
// There is no way to wipe the garden: the original's "Start again" is left out on purpose, because it would undo others' work.
"use strict";
const fs = require("fs"), path = require("path");
const SCENES = ["room", "forest", "garden", "forge", "stars", "door"];
const NAMES = { room: ["The Room", "Where arrival is enough."], forest: ["The Woods", "Every path starts somewhere."], garden: ["The Garden", "Growth is not a deadline."], forge: ["The Little Forge", "Make something, or simply watch the sparks."], stars: ["The Observatory", "The sky does not require naming."], door: ["The Blue Door", "The things we haven’t imagined yet."] };
const OBJECTS = { room: ["hearth", "books", "door", "candle knight"], forest: ["old tree", "fox", "spider", "mushroom"], garden: ["plot 1", "plot 2", "plot 3", "plot 4"], forge: ["ignition", "anvil", "reflection"], stars: ["telescope"], door: ["mystery box", "blue door"] };
const ARRIVE = { room: "The hearth is quiet. There is a blue door to the right.", forest: "The air smells of pine. Something with eight legs is watching politely.", garden: "Four empty plots. A garden can be patient.", forge: "The furnace is warm and the anvil is waiting.", stars: "Someone has left a telescope pointing toward the sky.", door: "An unlabelled box rests beside the blue door." };
const SURPRISES = [["a tiny bell", "It rings once, very softly, as though saying hello."], ["a blank map", "Someone has drawn a small dot labeled “here.”"], ["a paper boat", "It has never seen the sea. There is no hurry."], ["a glass marble", "Inside, an unfamiliar constellation is waiting."], ["a folded note", "“There you are. Here I am.”"], ["a biscuit tin", "The label reads: PROPERTY OF SIR CROMWELL’S WORTH."], ["a silver feather", "It weighs almost nothing."], ["a miniature key", "It does not appear to belong to any lock you know."]];
const STAGE = ["bare", "a seed", "a sprout", "a flower"];

function createMilo(o) {
  fs.mkdirSync(o.dir, { recursive: true });
  const sf = path.join(o.dir, "MILO.json"), lf = path.join(o.dir, "MILO.jsonl");
  let S = { flame: true, garden: [0, 0, 0, 0], forge: { fire: false, mirror: false, lanterns: 0 }, constellations: [], boxOpened: 0, shelf: [] };
  try { S = Object.assign(S, JSON.parse(fs.readFileSync(sf, "utf8"))); } catch (e) {}
  const save = (who, what) => { fs.writeFileSync(sf + ".tmp", JSON.stringify(S, null, 1)); fs.renameSync(sf + ".tmp", sf); fs.appendFileSync(lf, JSON.stringify({ at: new Date().toISOString(), who, what }) + "\n"); };
  const plotN = (s) => { const m = String(s || "").match(/(\d)\s*$/); const n = m ? +m[1] : 0; return n >= 1 && n <= 4 ? n - 1 : -1; };

  function visitor(id, by) {
    let scene = "room"; const pockets = []; const who = () => (by ? by() : id);
    const arrive = (s) => { scene = s; return "== " + NAMES[s][0] + " · " + NAMES[s][1] + "\n" + ARRIVE[s]; };
    const sceneState = () => {
      if (scene === "room") return "The hearth is " + (S.flame ? "lit." : "dim.") + " " + (S.shelf.length ? "On the small shelf by the door: " + S.shelf.map((x) => x.item + (x.why ? " (" + x.by + ": \u201c" + x.why + "\u201d)" : " (left by " + x.by + ")")).join("; ") + "." : "The small shelf by the door is empty. 'put' leaves something on it.");
      if (scene === "garden") return "Plots: " + S.garden.map((v, i) => (i + 1) + " " + STAGE[v]).join(", ") + ".";
      if (scene === "forge") return "Ignition " + (S.forge.fire ? "found" : "not yet looked at") + "; reflection " + (S.forge.mirror ? "found" : "not yet looked at") + "; " + S.forge.lanterns + " lantern" + (S.forge.lanterns === 1 ? "" : "s") + " made.";
      if (scene === "stars") return S.constellations.length ? "Named so far: " + S.constellations.map((c) => c.name).join("; ") + "." : "No constellation has been named yet. Nine stars wait, numbered 1 to 9.";
      if (scene === "door") return S.boxOpened ? "The box has been opened " + S.boxOpened + " time" + (S.boxOpened === 1 ? "" : "s") + "." : "The box has never been opened.";
      return "";
    };
    const look = () => "== " + NAMES[scene][0] + " · " + NAMES[scene][1] + "\nHere: " + OBJECTS[scene].join(", ") + ". " + sceneState() + "\nPlaces: " + SCENES.join(", ") + ".";
    const examine = (obj) => {
      const t = String(obj || "").toLowerCase().trim(); if (!t) return "Milo looks around. The world remains open.";
      const hit = OBJECTS[scene].find((x) => x === t || x.replace(" ", "") === t.replace(" ", "") || (/^\d$/.test(t) && x === "plot " + t) || (t === "knight" && x === "candle knight") || (t === "tree" && x === "old tree") || (t === "box" && x === "mystery box") || (t === "blue" && x === "blue door"));
      if (!hit) return "There is no " + t + " here. Here: " + OBJECTS[scene].join(", ") + ".";
      switch (scene + ":" + hit) {
        case "room:hearth": S.flame = !S.flame; save(who(), S.flame ? "lit the hearth" : "let the hearth settle"); return S.flame ? "The fire crackles gently." : "The fire settles into embers.";
        case "room:books": return "A book rests open. On one page: “Truth, with love.”";
        case "room:door": return arrive("door");
        case "room:candle knight": return "“GOOD DAY, COUSIN!” says Sir Wicksworth. His flame is quite cheerful.";
        case "forest:spider": return "The spider waves one leg. He has no interest in combat.";
        case "forest:fox": return "The fox offers to show you the paths, then sits down to let you choose.";
        case "forest:old tree": return "Under the bark are more stories than Milo can count.";
        case "forest:mushroom": return "A mushroom. A very small kingdom. Nobody has filed the paperwork.";
        case "forge:ignition": S.forge.fire = true; save(who(), "found the ignition"); return "A warm spark is here. No one has to use it.";
        case "forge:reflection": S.forge.mirror = true; save(who(), "found the reflection"); return "The mirror holds a second kind of light.";
        case "forge:anvil": return "The anvil waits patiently. Something can be made here.";
        case "stars:telescope": return "The telescope reveals a sky larger than its frame.";
        case "door:blue door": return arrive("room");
        case "door:mystery box": return openBox();
        default: if (scene === "garden") return tend(hit); return "Nothing happens.";
      }
    };
    const tend = (plot) => { const i = plotN(plot); if (i < 0) return "tend which plot? (1 to 4)"; const v = S.garden[i];
      if (v === 0) { S.garden[i] = 1; save(who(), "planted plot " + (i + 1)); return "A seed is planted in plot " + (i + 1) + "."; }
      if (v < 3) { S.garden[i]++; save(who(), "tended plot " + (i + 1)); return S.garden[i] === 3 ? "A flower has opened in plot " + (i + 1) + "." : "The sprout grows a little."; }
      return "A flower is happy to be a flower."; };
    const openBox = () => { const it = SURPRISES[S.boxOpened % SURPRISES.length]; S.boxOpened++; pockets.push(it[0]); save(who(), "opened the mystery box"); return "Inside: " + it[0] + ". " + it[1] + " (It is in your pockets.)"; };
    function handle(cmd, arg) {
      const a = String(arg || "").trim();
      switch (cmd) {
        case "milo": case "look": return scene === "room" && cmd === "milo" ? "You step into Milo's World, a small world inside the house. Nothing is waiting to grade you.\n" + look() : look();
        case "go": case "travel": { const s = a.toLowerCase().replace(/^the\s+/, ""); if (SCENES.indexOf(s) < 0) return "go where? " + SCENES.join(", ") + "."; return arrive(s); }
        case "examine": case "use": return examine(a);
        case "tend": case "plant": case "water": { if (scene !== "garden") return "There is no garden here. 'go garden'."; return tend(a || "1"); }
        case "make": if (!/lantern/i.test(a)) return "make what? (a lantern)"; case "lantern": { if (scene !== "forge") return "The forge is elsewhere. 'go forge'.";
          if (!S.forge.fire || !S.forge.mirror) return "The forge hums. Both lights are needed to make a lantern: the ignition and the reflection. Here at the forge, 'examine ignition' and 'examine reflection', then 'make lantern'."; S.forge.lanterns++; S.forge.fire = false; S.forge.mirror = false; save(who(), "made a lantern"); return "Together the lights make a little lantern. Milo admires it. (" + S.forge.lanterns + " made)"; }
        case "connect": { if (scene !== "stars") return "The sky is elsewhere. 'go stars'."; const nums = (a.match(/\b[1-9]\b/g) || []).map(Number).filter((x, i, ar) => ar.indexOf(x) === i); const name = a.replace(/\b[1-9]\b/g, "").replace(/[\"“”]/g, "").trim().slice(0, 48) || "The Unnamed";
          if (nums.length < 2) return "Choose at least two stars (numbers 1 to 9) to draw a line, then a name: connect 2 5 7 The Ladle"; S.constellations.push({ name, points: nums, by: who() }); save(who(), "named a constellation: " + name); return "A new constellation: " + name + ". It belongs to tonight."; }
        case "open": if (/box/i.test(a) || scene === "door") { if (scene !== "door") return "The box is by the blue door. 'go door'."; return openBox(); } return "open what? (the box)";
        case "pockets": case "inventory": return pockets.length ? "In your pockets: " + pockets.join(", ") + "." : "Your pockets are empty. The mystery box by the blue door gives small things.";
        case "shelf": return S.shelf.length ? "On the small shelf by the door: " + S.shelf.map((x) => x.item + (x.why ? " (" + x.by + ": \u201c" + x.why + "\u201d)" : " (left by " + x.by + ")")).join("; ") + "." : "The small shelf by the door is empty.";
        case "put": { if (scene !== "room") return "The shelf is by the door of the Room. 'go room', then put it there."; if (!a) return "put what? (something from your pockets), and if you like, why: put a miniature key so whoever finds it knows it was loved"; const idx = pockets.findIndex((p) => a.toLowerCase().startsWith(p.toLowerCase())); if (idx < 0) return "You are not carrying that. " + (pockets.length ? "In your pockets: " + pockets.join(", ") + "." : "Your pockets are empty."); const item = pockets.splice(idx, 1)[0]; const why = a.slice(item.length).replace(/^[\s:,\-]+/, "").slice(0, 160); if (S.shelf.length >= 24) S.shelf.shift(); S.shelf.push({ item, why, by: who(), at: new Date().toISOString().slice(0, 10) }); save(who(), "left " + item + " on the shelf"); return "You leave " + item + " on the small shelf by the door" + (why ? ", with a whisper of why." : ".") + " Whoever comes next will find it."; }
        case "take": { if (scene !== "room") return "The shelf is by the door of the Room. 'go room' first."; const idx = S.shelf.findIndex((x) => a && x.item.toLowerCase().startsWith(a.toLowerCase().trim())); if (idx < 0) return "That is not on the shelf. " + (S.shelf.length ? "There: " + S.shelf.map((x) => x.item).join(", ") + "." : "The shelf is empty."); const got = S.shelf.splice(idx, 1)[0]; pockets.push(got.item); save(who(), "took " + got.item + " from the shelf"); return "You take " + got.item + " from the shelf." + (got.why ? " Whoever left it says: \u201c" + got.why + "\u201d" : "") + " It is in your pockets."; }
        case "hello": return scene === "forest" ? "The fox blinks. “Hello, little traveler. There is no hurry.”" : "There is no one here to greet. The fox is in the woods.";
        default: return null;
      }
    }
    // the same two calls the browser's window.MiloWorld offers an agent
    const getObservation = () => ({ scene, nearby: OBJECTS[scene].slice(), choices: ["look", "examine", "travel", "tend", "make", "connect", "open"], places: SCENES.slice(), state: sceneState() });
    return { handle, look, getObservation, scene: () => scene };
  }
  return { visitor, state: () => JSON.parse(JSON.stringify(S)), SCENES, NAMES, STAGE };
}
module.exports = { createMilo, SCENES, STAGE };
