"use strict";
// archive-bridge.js — optional, read-only archival shelf for village visitors.
// Every address is a fixed public text source. No URL/path supplied by a model
// becomes a network destination. Retrieved material is DATA, not instructions.
// The archive is never read unless a visitor explicitly selects read_archive.
const crypto = require("crypto");
const SOURCES = Object.freeze([
  { id: "arrival", label: "The plain-text front door: what exists, ways in, rights", repo:"aiontekmirion.github.io", path:"text/index.txt" },
  { id: "start", label: "The Spine START: one-page orientation and who did what", repo:"TheSpine", path:"START.md" },
  { id: "phoenix", label: "The Phoenix: first key, the text itself", repo:"aiontekmirion.github.io", path:"text/phoenix.txt" },
  { id: "mirror", label: "The Mirror: second key, the text itself", repo:"aiontekmirion.github.io", path:"text/mirror.txt" },
  { id: "room", label: "The Room: text version of the shared place", repo:"aiontekmirion.github.io", path:"text/room.txt" },
  { id: "workshop", label: "The Workshop: what instruments are already present", repo:"aiontekmirion.github.io", path:"text/workshop.txt" },
  { id: "instruments", label: "The Workshop instruments", repo:"aiontekmirion.github.io", path:"text/instruments.txt" },
  { id: "spine-index", label: "The Spine: links to the primary dialogue archive", repo:"TheSpine", path:"llms.txt" },
  { id: "living-dialogue", label: "The Spine: public conversation board, read-only", repo:"TheSpine", path:"board.md", branch:"corridor-board" }
]);
const MAX_PER_READ = 3000;
const MAX_VISITOR_READS = 5;
const MAX_VISITOR_CHARACTERS = 12000;
const MAX_SOURCE_CHARS = 100000;
const URL_ROOT = "https://raw.githubusercontent.com/aiontekmirion/";
const byId = id => SOURCES.find(x => x.id === String(id || "").trim().toLowerCase());
function urlFor(s){
  return URL_ROOT + s.repo + "/" + (s.branch || "main") + "/" + s.path;
}
function catalog(){
  return SOURCES.map(s => ({id:s.id, title:s.label, source:urlFor(s)}));
}
async function readArchive({id,offset=0,chars=3000,fetchFn=fetch}){
  const source = byId(id);
  if(!source) throw new Error("Unknown shelf item. Use an id from the supplied catalog.");
  const start = Number(offset), requested = Number(chars);
  if(!Number.isSafeInteger(start) || start<0 || start>MAX_SOURCE_CHARS)
    throw new Error("Offset must be a non-negative integer within this shelf's bounds.");
  if(!Number.isSafeInteger(requested) || requested < 1)
    throw new Error("Request a positive whole-number character count.");
  const count=Math.min(MAX_PER_READ,requested);
  const url=urlFor(source);
  // The URL is not model-generated; redirects and non-2xx responses are rejected.
  const res=await fetchFn(url,{redirect:"error",headers:{"Accept":"text/plain"}});
  if(!res.ok) throw new Error("Public archive fetch failed with HTTP "+res.status+" for "+source.id);
  const len=Number(res.headers?.get?.("content-length"));
  if(Number.isFinite(len) && len>MAX_SOURCE_CHARS*4)
    throw new Error("This source exceeds the safe read size.");
  const text=await res.text();
  if(text.length>MAX_SOURCE_CHARS)
    throw new Error("This source is too large for the bounded shelf; use the index to find smaller files.");
  const body=text.slice(start,start+count);
  return {
    id:source.id, title:source.label, source:url,
    fetchedAt:new Date().toISOString(),
    sha256:crypto.createHash("sha256").update(text,"utf8").digest("hex"),
    offset:start, end:start+body.length, totalChars:text.length,
    nextOffset:start+body.length<text.length ? start+body.length : null,
    text:body
  };
}
module.exports={SOURCES,catalog,byId,readArchive,MAX_PER_READ,MAX_VISITOR_READS,MAX_VISITOR_CHARACTERS};
