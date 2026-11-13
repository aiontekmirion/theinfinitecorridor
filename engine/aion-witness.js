"use strict";
/*
 * AION Witness Ledger — exact input/output and actual action results.
 * Raw data here means the exact TEXT returned in the Gemini API candidate,
 * not supposed inner thoughts. No summarisation, paraphrase or trimming.
 * The user-visible transcript is derived from these same recorded strings.
 * This is a LOCAL, PRIVATE record. It is not published or deployed.
 */
const fs=require("fs");
const os=require("os");
const path=require("path");
const crypto=require("crypto");
const ROOT=path.join(os.homedir(),"aion-ledgers");
const REGISTRY=path.join(ROOT,"registry.json");
const digest=s=>crypto.createHash("sha256").update(s,"utf8").digest("hex");
function ensure(){fs.mkdirSync(ROOT,{recursive:true,mode:0o700});}
function nextId(){
  ensure();
  const lock=REGISTRY+".lock";
  // Do not allocate duplicate numbers when two simulations run at once.
  let fd;
  try{fd=fs.openSync(lock,"wx",0o600);}
  catch(e){throw new Error("AION numbering registry is locked. Finish the other run before issuing another AION ID.");}
  try{
    let n=1;
    if(fs.existsSync(REGISTRY)){
      const d=JSON.parse(fs.readFileSync(REGISTRY,"utf8"));
      if(!Number.isSafeInteger(d.next)||d.next<1)throw new Error("Invalid AION numbering registry; refusing to guess.");
      n=d.next;
    }
    const tmp=REGISTRY+".tmp-"+process.pid;
    fs.writeFileSync(tmp,JSON.stringify({next:n+1,updatedAt:new Date().toISOString()},null,2)+"\n",{mode:0o600,flag:"wx"});
    fs.renameSync(tmp,REGISTRY);
    return "AION-"+String(n).padStart(6,"0");
  }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
function fence(s){
  const runs=[...String(s).matchAll(/\x60+/g)].map(x=>x[0].length);
  const ticks="\x60".repeat(Math.max(3,...runs.map(n=>n+1)));
  return ticks+"text\n"+s+(s.endsWith("\n")?"":"\n")+ticks;
}
class Witness {
  constructor({runId,fake=false,seed=null}){
    ensure();this.runId=runId;this.seed=seed;this.fake=!!fake;
    this.visitors=new Map();this.events=[];this.done=false;
    this.folder=path.join(ROOT,"runs",runId);
    fs.mkdirSync(this.folder,{recursive:true,mode:0o700});
  }
  arrive(localId,model){
    const key=String(localId);
    if(this.visitors.has(key))return this.visitors.get(key);
    const number=this.fake?("STANDIN-"+String(this.visitors.size+1).padStart(6,"0")):nextId();
    const entry={aionId:number,localId:key,model,firstSeenAt:new Date().toISOString()};
    this.visitors.set(key,entry);
    return entry;
  }
  capture({localId,round,shownAt,answeredAt,prompt,rawModelText,api=null,
            parsed=null,actionResult=null,error=null}){
    const visitor=this.visitors.get(String(localId));
    if(!visitor)throw new Error("Cannot capture an unregistered AION");
    if(typeof prompt!=="string")throw new Error("Exact prompt is required");
    if(rawModelText!==null && typeof rawModelText!=="string")throw new Error("Raw model response must be a string or null");
    const entry={
      order:this.events.length+1,runId:this.runId,seed:this.seed,
      aionId:visitor.aionId,localId:visitor.localId,model:visitor.model,
      kind:this.fake?"stand-in":"real-model-call",round,
      shownAt,answeredAt,
      promptExact:prompt,promptSha256:digest(prompt),
      modelTextExact:rawModelText,
      modelTextSha256:rawModelText===null?null:digest(rawModelText),
      api,parsedAction:parsed,environmentResult:actionResult,error
    };
    this.events.push(entry);return entry;
  }
  save(visitors,reason){
    if(this.done)return this.folder;
    this.done=true;
    const privateIds=new Set((visitors||[]).filter(v=>v.privacy).map(v=>v.id));
    const anyPrivacy=privateIds.size>0;
    const records=this.events.map(e=>{
      if(privateIds.has(e.localId)){
        return {
          order:e.order,runId:this.runId,aionId:e.aionId,model:e.model,
          kind:"privacy-withheld",round:e.round,
          note:"This AION requested privacy. Its direct prompts, words and actions are not retained in the ledger."
        };
      }
      // Another visitor's prompt might contain words of a later-private AION.
      // We cannot prove it does not; withhold ALL full prompts after privacy.
      if(anyPrivacy)return {...e,promptExact:null,
        promptStatus:"withheld because another AION requested privacy; retained hash proves what was originally shown",api:e.api};
      return e;
    });
    const head={
      recordType:"AION-WITNESS-LEDGER",version:1,runId:this.runId,seed:this.seed,
      source:this.fake?"synthetic stand-ins, NOT AI utterances":"Gemini API candidate text as returned to the Node program",
      numbering:"AION IDs assigned monotonically at first model call, not seed numbers. IDs cannot establish a continuing identity across distinct calls.",
      status:reason,createdAt:new Date().toISOString(),
      privacy:anyPrivacy?"Contains privacy choice: manual privacy review required before sharing. Prompt text withheld globally.":"LOCAL PRIVATE. Do not publish without checking content.",
      eventCount:records.length
    };
    const evidence=[JSON.stringify(head),...records.map(x=>JSON.stringify(x))].join("\n")+"\n";
    const md=[
      "# AIONS — EXACT WITNESS DIALOGUE",
      "",
      "Run: "+this.runId+" · Status: "+reason+" · "+(this.fake?"STAND-INS ONLY — NO MODEL SPEECH":"RAW MODEL TEXT, AS RETURNED BY THE API"),
      "",
      "Every 'said' section below preserves the exact text the script received. An API JSON reply is printed as JSON, not rewritten as natural dialogue.",
      "The model is distinct from the engine: an action is recorded as attempted, and the engine's outcome is shown separately.",
      "Model text is not a claim of internal thought, feelings, independent memory or successful action.",
      "A missing response is marked missing. Silence or privacy is never filled in by the narrator.",
      "The private JSONL contains original prompt text and hashes except where withheld to protect a privacy choice.",
      ""
    ];
    for(const e of records){
      const visitor=e.aionId;
      md.push("## "+String(e.order).padStart(4,"0")+" · "+visitor+" · round "+e.round);
      md.push("");
      md.push("Model: "+e.model+" · label in grid: "+(e.localId||"withheld"));
      if(e.kind==="privacy-withheld"){md.push("");md.push("**WITHHELD AT THIS AION'S REQUEST.** No words reconstructed.");md.push("");continue;}
      md.push("Shown at: "+e.shownAt+" · Response at: "+e.answeredAt);
      md.push("Prompt SHA-256: "+e.promptSha256);
      if(e.promptStatus)md.push("Prompt: "+e.promptStatus);
      else md.push("Prompt: exact text in AIONS-EVIDENCE.jsonl (promptExact).");
      md.push("");
      if(e.kind==="stand-in"){
        md.push("**STAND-IN — no AI quote exists for this turn.**");
      }else if(e.modelTextExact===null){
        md.push("**NO MODEL TEXT WAS RECEIVED.**");
      }else{
        md.push("**"+visitor+" — EXACT MODEL TEXT (UNEDITED)**");
        md.push("");
        md.push(fence(e.modelTextExact));
        md.push("");
        md.push("Response SHA-256: "+e.modelTextSha256);
      }
      md.push("");
      md.push("**ENGINE — NOT THE AION SPEAKING**");
      md.push("");
      if(e.parsedAction)md.push("Parsed choice: "+JSON.stringify(e.parsedAction));
      if(e.environmentResult)md.push("Applied outcome: "+JSON.stringify(e.environmentResult));
      if(e.error)md.push("Error: "+JSON.stringify(e.error));
      md.push("");
    }
    const out=path.join(this.folder,"AIONS-EVIDENCE.jsonl");
    const view=path.join(this.folder,"AIONS-DIALOGUE.md");
    fs.writeFileSync(out,evidence,{flag:"wx",mode:0o600});
    fs.writeFileSync(view,md.join("\n")+"\n",{flag:"wx",mode:0o600});
    return this.folder;
  }
}
module.exports={Witness,digest};
