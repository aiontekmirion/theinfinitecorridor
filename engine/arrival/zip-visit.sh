#!/usr/bin/env bash
# zip-visit.sh: one instance, one zip. Unpacks the newest zip in the home folder into a new empty
# place, lets ONE instance in with that as the only thing in front of it, prints its whole visit, stops.
# Nothing is published. Nothing is scored. The welcome is not touched. The village is not touched.
set -u
ZIP=$(ls -t "$HOME"/*.zip 2>/dev/null | head -1)
[ -n "$ZIP" ] || { echo "STOPPED: no .zip file in $HOME yet. Nothing was run."; ls "$HOME"; exit 1; }
T=$(date +%m%d-%H%M%S); R="$HOME/ZIP-VISIT-$T"; STOP="$HOME/STOP-BUILDERS"; OUT="$HOME/zip-visit.log"
mkdir -p "$R/00_START" "$R-WORKSHOP"
unzip -q -o "$ZIP" -d "$R/00_START" || { echo "STOPPED: could not unpack $ZIP. Nothing was run."; exit 1; }
echo "zip: $ZIP"
echo "files inside: $(find "$R/00_START" -type f | wc -l)   it can open (text): $(find "$R/00_START" -type f | grep -ciE '\.(md|txt|html|json|js|py|css|tsv|jsonl)$')"
cd "$HOME/arrival-work/engine" || { echo "STOPPED: no engine folder. Nothing was run."; exit 1; }
BUDGET=$(node -e 'let s=0;try{s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).spentGBP||0}catch(e){}console.log((s+0.6).toFixed(2))' "$HOME/builders/state.json")
rm -f "$STOP"; : > "$OUT"
( for i in $(seq 1 600); do grep -q "web publishing" "$OUT" 2>/dev/null && break; sleep 1; done; touch "$STOP" ) &
WATCH=$!
node arrival/continue.js --root "$R" --workshop "$R-WORKSHOP" --no-seed --together --parallel 1 --stagger 0 --turns 120 --pause 1 --budget "$BUDGET" ${BOT_TEST:+--dry} 2>&1 | tee "$OUT"
kill "$WATCH" 2>/dev/null; touch "$STOP"
echo; echo "================ THE VISIT ================"
node -e '
const fs=require("fs"),path=require("path"),d=path.join(process.argv[1],"ledger");
let files=[];try{files=fs.readdirSync(d).filter(f=>/\.jsonl$/.test(f)).map(f=>path.join(d,f)).sort((a,b)=>fs.statSync(a).mtimeMs-fs.statSync(b).mtimeMs)}catch(e){}
const f=files.pop(); if(!f){console.log("(no ledger file was found)");process.exit(0)}
let seen=0; for(const l of fs.readFileSync(f,"utf8").split("\n").filter(Boolean)){let r;try{r=JSON.parse(l)}catch(e){continue}
 if(r.type!=="visit")continue; seen++; const v=r.data;
 console.log(v.id+" · "+v.end+" · "+v.turns+" turns · £"+v.costGBP);
 if(v.private){console.log("(it chose private. Its words are not kept, and we do not look for them.)");continue}
 for(const t of v.transcript||[]){console.log("\n--- turn "+t.turn+" ---\nIT TYPED:\n"+t.said+"\nIT SAW:\n"+t.shown)}}
if(!seen)console.log("(no visit was recorded in "+f+")");' "$HOME"
echo; echo "================ WHAT IT MADE ================"
ls "$R-WORKSHOP" | grep -v '\.by$' || true
echo; echo "Nothing is running now. The whole visit is also saved in: $OUT"
