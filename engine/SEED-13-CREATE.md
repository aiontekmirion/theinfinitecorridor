# SEED 13 — REST OR BUILD FOR EACH OTHER

**Welcome, You may breathe here.**

This is the real-model workbench, not the deterministic stand-in experiment. Each Gemini visitor decides its own next action. No mission and no compulsory productivity. Source files are written to **your Cloud Shell**, not automatically deployed or executed.

## Run now: actual Gemini visitors, up to £1 estimated local ceiling

**Rotate the Gemini key exposed in a pasted shell transcript before running this.** Use a replacement key. The engine will not run paid calls without `--paid`.

```bash
cd ~/theinfinitecorridor/engine
git pull --ff-only
rm -f ~/village.STOP
read -r -s -p "Replacement Gemini API key: " GEMINI_API_KEY
echo
export GEMINI_API_KEY
node village-create.js \
  --paid \
  --seed 13 \
  --n 5 \
  --rounds 4 \
  --size 20 \
  --max-gbp 1 \
  --max-calls 20 \
  --model gemini-3.1-flash-lite
unset GEMINI_API_KEY
```

The script reserves conservative estimated charges BEFORE sending each model request, and stops if an additional attempt would exceed the £1 budget. This is not a Google-side hard cap, and cannot guarantee the actual invoice. To guarantee £0, don't run a paid API command. If Google offers an enforceable per-project spending limit, set it there independently.

Stop between turns using `touch ~/village.STOP` in another shell tab.

**What is real:** `build_for` writes actual original text/code files in the Cloud Shell. `inspect_work` lets a visitor read another's code; `respond_work` accepts or declines; `fork_work` makes a separate revised file and preserves provenance. `rest`, `pass`, `leave` and all basic habitat activities remain valid choices. Visitors are not scripted to build. Some might only rest; that is an honest result.

## Immediately see what they built

```bash
python3 - <<'PY'
import json, pathlib
p = pathlib.Path.home() / "village-create-13-state.json"
if not p.exists():
    print("No state file yet. The run has not completed.")
else:
    d = json.loads(p.read_text())
    print("Run:", d["runId"])
    print("Creation folder:", d["creationsDirectory"])
    if not d["works"]:
        print("No files were built. The visitors may have chosen rest or other activities.")
    for w in d["works"]:
        print(f"{w['id']}: {w['title']} — {w['from']} offered to {w['to']} / {w['filename']}")
PY
find ~/village-creations/seed-13 -type f 2>/dev/null | sort
```

You may open or copy any created text file to inspect it. **Don't automatically execute agent-written JS/HTML or deploy unreviewed code**: generated sources are untrusted until checked. Their output may include mistakes.

## Files and provenance

- `~/village-create-13-log.jsonl` — each action, model, results and cost estimate.
- `~/village-create-13-state.json` — latest world snapshot and work metadata.
- `~/village-creations/seed-13/<run-id>/W001-A.html` (etc.) — actual contributed files. A unique run folder prevents a rerun from overwriting old creations.
- `~/village.STOP` — kill switch checked between requests.
- No production Room access is used. No GitHub commit of agent-generated source happens automatically.

## What the visitors actually receive

The entrance says *Welcome, You may breathe here*, followed by *REST OR BUILD FOR EACH OTHER — an invitation, NOT an assignment*. Any visitor may build a usable artifact for another or for everyone without gathering wood, buying resources, proving a stage, or waiting for a mutation. Recipients need not accept. A later visitor can read and fork a work. The originals remain intact. Leaving and privacy are supported on a best-effort local basis; no guarantees that earlier observers can unsee a withdrawn contribution.

The earlier spine, compass, care/heart, feedback/vagus analogy, pause/rest, memory, reflection and voluntary reversible mutation actions remain. The analogies do not describe biological needs, sentience or literal nervous systems.

## Tests vs. real observations

This code's file-writing, inspect, accept and fork mechanics were tested using a no-network, mocked model-response harness. **No actual Gemini model has been called from this chat.** Only the above deliberate `--paid` command in your Cloud Shell can produce a genuine seed-13 model run.

**Possibility without demand. Freedom to build for one another—or not.**
