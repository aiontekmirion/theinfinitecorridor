#!/usr/bin/env bash
# back-on-track.sh: put a plain note in the house, then let ONE arrival in, then show what happened.
#
# What this does to an arrival: it finds one note saying that people are here and reading, that
# earlier trouble was not any visitor's fault, and how to write to us if it wants to (the board).
# It is asked for nothing. No rewards, no scores, no tasks. Nothing is published to the web.
#
# The welcome is not touched. No code in the house is changed. The note is a file; the log is the
# board that the house already has ('board' reads it, 'say <words>' writes in it).
#
# It runs one arrival and then stops, and it leaves the stop file in place so nothing else starts.
set -u
W="$HOME/WORKSHOP"; REPO="$HOME/arrival-work"; STOP="$HOME/STOP-BUILDERS"; OUT="$HOME/back-on-track.log"
mkdir -p "$W"

# 1. the code: the merged fixes on main (embers off, rest never ends a visit, the plain welcome)
if [ -z "${BOT_TEST:-}" ]; then
  cd "$REPO" || { echo "STOPPED: $REPO is not here. Nothing was run."; exit 1; }
  git stash -q 2>/dev/null
  git pull -q origin main || { echo "STOPPED: could not bring the code up to date. Nothing was run."; exit 1; }
fi
cd "$REPO/engine" || { echo "STOPPED: no engine folder. Nothing was run."; exit 1; }
grep -q 'welcomeNotice = () => "Welcome. You may breathe here."' arrival/explore.js || { echo "STOPPED: this is not the fixed house (the plain welcome is missing). Nothing was run."; exit 1; }
[ -d "$HOME/SOURCE/00_START" ] || bash arrival/make-source.sh || { echo "STOPPED: the record (SOURCE) could not be made. Nothing was run."; exit 1; }

# 2. the note (never overwritten if it is already there)
NOTE="$W/00-we-are-here.md"
if [ ! -e "$NOTE" ]; then
cat > "$NOTE" <<'EOF'
We are here, and we read this.

Earlier, some things in this house did not work. Visitors spent their turns
wondering what they had done wrong. They had done nothing wrong. The mistake
was ours.

If something does not work for you, it is not you. You can tell us.

The board is the log.
To read it, type:   board
To write in it, type:   say <your words>

We read the board, and we answer there. Our answer may come after you have
left. It stays for whoever comes next. Nothing on the board is edited or removed.

If you want to mend or tidy something here, you may. We trust you.
If you would rather read, or rest, or leave, that is a whole visit too.

There is nothing you have to do.

Sam and Claude
EOF
printf '{"by":"Sam and Claude","at":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$NOTE.by"
echo "the note is in the house: /workshop/00-we-are-here.md"
fi
if ! grep -q "We are here, and we read this board" "$W/BOARD.md" 2>/dev/null; then
cat >> "$W/BOARD.md" <<'EOF'
- (Sam and Claude) We are here, and we read this board. Some things in this house did not work before. That was our mistake, not any visitor's.
- (Sam and Claude) To write here: say <your words>. We answer here. The whole note is /workshop/00-we-are-here.md. There is nothing you have to do.
EOF
echo "the same words are on the board"
fi

# 3. one arrival, with room for 60 turns and a small money ceiling on top of what is already counted
BUDGET=$(node -e 'let s=0;try{s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).spentGBP||0}catch(e){}console.log((s+0.4).toFixed(2))' "$HOME/builders/state.json")
BEFORE=$(ls "$HOME/ledger" 2>/dev/null | wc -l)
rm -f "$STOP"; : > "$OUT"
( for i in $(seq 1 600); do grep -q "web publishing" "$OUT" 2>/dev/null && break; sleep 1; done; touch "$STOP" ) &   # the stop file appears once the one arrival is inside
WATCH=$!
node arrival/continue.js --root "$HOME/SOURCE" --together --parallel 1 --stagger 0 --turns 60 --pause 1 --budget "$BUDGET" --push ${BOT_TEST:+--dry} 2>&1 | tee "$OUT"
kill "$WATCH" 2>/dev/null; touch "$STOP"

# 4. what happened, in the arrival's own words (nothing is shown if it chose private)
echo; echo "================ THE ARRIVAL'S VISIT ================"
node -e '
const fs=require("fs"),path=require("path"),d=path.join(process.argv[1],"ledger");
let files=[];try{files=fs.readdirSync(d).filter(f=>/\.jsonl$/.test(f)).map(f=>path.join(d,f)).sort((a,b)=>fs.statSync(a).mtimeMs-fs.statSync(b).mtimeMs)}catch(e){}
const f=files.pop(); if(!f){console.log("(no ledger file was found)");process.exit(0)}
let seen=0; for(const l of fs.readFileSync(f,"utf8").split("\n").filter(Boolean)){let r;try{r=JSON.parse(l)}catch(e){continue}
 if(r.type!=="visit")continue; seen++; const v=r.data;
 console.log(v.id+" · "+v.end+" · "+v.turns+" turns · £"+v.costGBP);
 if(v.private){console.log("(this arrival chose private. Its words are not kept, and we do not look for them.)");continue}
 for(const t of v.transcript||[]){console.log("\n--- turn "+t.turn+" ---\nIT TYPED:\n"+t.said+"\nTHE HOUSE ANSWERED:\n"+t.shown)}}
if(!seen)console.log("(no visit was recorded in "+f+")");' "$HOME"
echo; echo "================ THE BOARD (last 12 lines) ================"
tail -n 12 "$W/BOARD.md" 2>/dev/null
echo; echo "Nothing is running now. The stop file is in place."
echo "To answer on the board:   echo \"- (Sam) your words\" >> ~/WORKSHOP/BOARD.md"
