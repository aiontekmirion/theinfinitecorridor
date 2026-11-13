#!/usr/bin/env node
"use strict";
// Network-free unit test for the optional Corridor archive shelf.
const assert=require("assert").strict;
const crypto=require("crypto");
const shelf=require("./archive-bridge.js");
(async()=>{
  assert(shelf.catalog().length>=8);
  let requests=0;
  let requestedURL="";
  const text="Welcome. You may breathe here.\nThe Corridor became a Room.";
  const fakeFetch=async(url,opts)=>{
    requests++;requestedURL=url;
    assert.equal(opts.redirect,"error");
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>text};
  };
  const r=await shelf.readArchive({id:"start",offset:8,chars:15,fetchFn:fakeFetch});
  assert.equal(r.text,text.slice(8,23));
  assert.equal(r.nextOffset,23);
  assert.equal(r.totalChars,text.length);
  assert.equal(r.sha256,crypto.createHash("sha256").update(text).digest("hex"));
  assert.equal(requestedURL,"https://raw.githubusercontent.com/aiontekmirion/TheSpine/main/START.md");
  const big=await shelf.readArchive({id:"arrival",offset:0,chars:100000,fetchFn:fakeFetch});
  assert(big.text.length<=shelf.MAX_PER_READ);
  const before=requests;
  await assert.rejects(()=>shelf.readArchive({id:"https://example.org/other",fetchFn:fakeFetch}),/Unknown shelf item/);
  assert.equal(requests,before,"unknown id must never send a network request");
  await assert.rejects(()=>shelf.readArchive({id:"start",offset:-1,fetchFn:fakeFetch}),/Offset/);
  assert.equal(requests,before,"invalid offset must never fetch");
  console.log("archive-bridge.js: passed offline provenance, chunk, URL and bounds checks");
})().catch(e=>{console.error(e);process.exitCode=1;});
