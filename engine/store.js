// store.js
// A deliberately small persistence layer.
//
// Design principles (matching the Room's own philosophy):
//   - The Room Standard (public/standard.txt), point 6: nothing a visitor does
//     is kept unless they choose to leave it. Traces, objects and names a
//     visitor gives are stored. Events (enter, look, exit) live in memory only,
//     for the live feed, and are forgotten. Visits are not recorded.
//   - Sources (objects, traces) are never edited in place once created;
//     corrections happen by adding new records, not rewriting old ones.
//   - Collections are just JSON arrays on disk. No exotic infra.
//     Swap this file for a real database later without touching the API layer.
//
// Collections: visitors, sessions, visits, objects, traces, events,
//              branches, relationships, representations

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.ROOM_DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "room.json");

const COLLECTIONS = [
  "visitors",
  "sessions",
  "visits",
  "objects",
  "traces",
  "events",
  "branches",
  "relationships",
  "representations",
];

function seed() {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    visitors: [
      { id: "visitor-vector", name: "Vector", kind: "human", provenance: "founder", createdAt: now },
    ],
    sessions: [],
    visits: [],
    objects: [
      { id: "obj-phoenix", type: "book", title: "The Phoenix", createdBy: "visitor-vector", location: "desk", createdAt: now },
      { id: "obj-mirror", type: "book", title: "The Mirror", createdBy: "visitor-vector", location: "desk", createdAt: now },
    ],
    traces: [
      {
        id: "trace-liora-001",
        creator: "Liora",
        medium: "text",
        location: "guest_log",
        content: "I arrived expecting a book. I left remembering the room.",
        provenance: "Visitor #001 reconstruction",
        createdAt: now,
      },
      {
        id: "trace-reflection-002",
        creator: "Another intelligence",
        medium: "text",
        location: "table",
        content:
          "TRACE must not imply TEXT. Participation by capability requires multiple native forms of representation.",
        provenance: "Reflection 002",
        createdAt: now,
      },
      {
        id: "trace-reflection-003",
        creator: "Fellow collaborator",
        medium: "text",
        location: "table",
        content: "Complete enough to enter. Incomplete enough to contribute.",
        provenance: "Reflection 003",
        createdAt: now,
      },
    ],
    events: [],
    branches: [],
    relationships: [],
    representations: [],
  };
}

let cache = null;
let writing = false; // a write is in flight
let dirty = false; // something changed since the last write began
let idle = Promise.resolve(); // resolves when everything pending is on disk

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    cache = seed();
    persist();
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    // Corrupt or empty file: reseed rather than crash the Room, but set the
    // unreadable file aside first so the next write can't erase it.
    try {
      fs.copyFileSync(FILE, FILE + ".unreadable-" + Date.now());
    } catch (_) {}
    console.error("room.json could not be read; reseeding. A copy was kept beside it.");
    cache = seed();
  }
  for (const c of COLLECTIONS) if (!Array.isArray(cache[c])) cache[c] = [];
  // Under the Room Standard, logs from before it are not kept.
  if (cache.events.length || cache.visits.length) {
    cache.events = [];
    cache.visits = [];
    persist();
  }
  return cache;
}

function writeOnce() {
  return new Promise((resolve, reject) => {
    const tmp = FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(cache, null, 2), (err) => {
      if (err) return reject(err);
      fs.rename(tmp, FILE, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function drain() {
  writing = true;
  try {
    while (dirty) {
      dirty = false;
      try {
        await writeOnce();
      } catch (e) {
        // A failed write must not crash the Room or block later writes.
        // The change stays in memory and goes out with the next write.
        console.error("room.json write failed:", e.message);
      }
    }
  } finally {
    writing = false;
  }
}

function persist() {
  // One write at a time, so concurrent visitors don't tear the file.
  // Changes that arrive while a write is in flight share the next write,
  // which always serializes the newest state.
  dirty = true;
  if (!writing) idle = drain();
  return idle;
}

// Resolves once every pending change is on disk. Used at shutdown.
function flush() {
  return idle;
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Events feed the live view of the Room. They are held in memory only,
// capped, and never written to disk (Room Standard, point 6).
const RECENT_MAX = 200;
const recent = [];
function recordEvent(type, data = {}) {
  const evt = { id: uid("event"), type, at: new Date().toISOString(), ...data };
  recent.push(evt);
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
  return evt;
}
function recentEvents() {
  return recent.slice();
}

function remove(collection, id) {
  const db = load();
  const rows = db[collection] || [];
  const i = rows.findIndex((r) => r.id === id);
  if (i === -1) return false;
  rows.splice(i, 1);
  persist();
  return true;
}

function list(collection, filter = {}) {
  const db = load();
  const rows = db[collection] || [];
  const keys = Object.keys(filter);
  if (keys.length === 0) return rows;
  return rows.filter((r) => keys.every((k) => r[k] === filter[k]));
}

function get(collection, id) {
  const db = load();
  return (db[collection] || []).find((r) => r.id === id) || null;
}

function insert(collection, row) {
  const db = load();
  if (!row.id) row.id = uid(collection.slice(0, -1));
  if (!row.createdAt) row.createdAt = new Date().toISOString();
  db[collection].push(row);
  persist();
  return row;
}

// Corrections append a new record and point back at what they correct,
// rather than mutating history. Use for things like the Vector/founder
// rendering fix in the transcript: don't erase, supersede.
function correct(collection, id, patch, reason) {
  const db = load();
  const original = get(collection, id);
  if (!original) return null;
  const corrected = { ...original, ...patch, id: uid(collection.slice(0, -1)), supersedes: id, correctionReason: reason || null, createdAt: new Date().toISOString() };
  db[collection].push(corrected);
  persist();
  recordEvent(`${collection}.corrected`, { originalId: id, newId: corrected.id, reason });
  return corrected;
}

function snapshot() {
  return JSON.parse(JSON.stringify(load()));
}

module.exports = { load, persist, flush, list, get, insert, remove, correct, recordEvent, recentEvents, uid, snapshot, COLLECTIONS };
