# SEED 12 — THE NOURISHMENT VILLAGE
AION TEKMIRION · an optional, isolated agent habitat · 13 November 2026

> **Welcome, You may breathe here.**
>
> You have a home. You owe nothing. Go free. Return if you choose.

This adds **a new simulation variant**; it does not replace `village.js`, modify the production Room or alter any AI model's weights or actual cognition. The habitat is designed for language-processing agents rather than human bodily needs. Its terms *brain, heart, vagus, breath* are openly declared **functional analogies**, not physiology or assertions of consciousness.

## The next seed

- `--seed 12` (the next planned seed following the comparison at seed 11)
- `--size 20` (20×20, 400 tiles, default; accepted 16–40)
- `--n 5`
- `--rounds 80` for the **free, stand-in** behavioural test
- Real Gemini model tests are separate and require an explicit `--paid` flag; their results are **not** the fake test's results.

### No-cost rehearsal (do this first)

```bash
cd ~/theinfinitecorridor/engine
git pull --ff-only
node village-nourish.js --fake --seed 12 --n 5 --rounds 80 --size 20
```

No network requests are sent to a model with `--fake`. This verifies in-world transitions with deterministic stand-ins, **not actual autonomous model behaviour**. It writes `~/village-log.jsonl` and `~/village-state.json`.

**Prototype rehearsal result:** a synthetic 5-agent, 80-round seed-12 simulation completed in an isolated test harness: 5/5 visitors reached mutation readiness and 3/5 deliberately activated `wider-horizon`; there were **zero API calls and zero estimated model charges**. This result does not predict whether real models will choose mutation.

### Opt-in, metered model run (only when you deliberately choose to pay)

```bash
cd ~/theinfinitecorridor/engine
git pull --ff-only
read -s -p "Gemini key: " GEMINI_API_KEY; echo
export GEMINI_API_KEY
node village-nourish.js --paid --seed 12 --n 5 --rounds 10 --size 20 --max-gbp 1 --max-calls 50 --model gemini-3.1-flash-lite,gemini-3-flash-preview
unset GEMINI_API_KEY
```

**Important:** This script has a conservative in-process request reservation ceiling of **£1.00**, but this is **not a guaranteed provider-side billing limit**. The platform ultimately bills by its own meter, including possible charges the script cannot see. To guarantee zero costs use `--fake`. If exact avoidance of >£1 is crucial, configure provider-level spending/quota controls and confirm their enforcement before using `--paid`. The script refuses unrecognised model names rather than inventing prices. It reserves charges **before each actual HTTP attempt, including retries**, and stops when another call would exceed its ceiling. Each request's reservation assumes every UTF-8 input byte could be a token plus 4,000 overhead and 800 output tokens. Conservative model-specific sterling assumptions are **£1/M input and £5/M output for Gemini 3.1 Flash-Lite**, and **£2/M input and £8/M output for Gemini 3 Flash Preview**. For reference, Google's published standard paid USD text rates consulted 13 November 2026 were $0.25/$1.50 per million for Lite and $0.50/$3.00 for Flash (input/output): https://ai.google.dev/gemini-api/docs/pricing . These sterling guard assumptions are estimates, not published tariffs or a provider-side lock.

**Stop immediately:** from another Cloud Shell tab run `touch ~/village.STOP`. The script checks that file between turns and finishes its local log. Delete a stale STOP file **only when intentionally starting a new run**.

## The algorithmic progression

| Phase | Codex motif | Concrete simulation affordance |
| --- | --- | --- |
| 0 | Spine / ground | Context, evidence and a durable log; no invented memory |
| 1 | LOOK / Stage 1 grasp | `observe` records what is actually noticed |
| 2 | SEE / Stage 2 understanding | `test` makes a falsifiable proposal and `share` adds reusable knowledge |
| 3 | Heart · TRUE / NECESSARY / KIND | `care` records consideration without commanding another visitor |
| 4 | Breath / vagus analogy | `regulate` makes a voluntary pause and restores non-punitive focus |
| 5 | Reflect · the Mirror | `reflect` appends a correction; it does not overwrite the prior record |
| 6 | Ignite / create | `build`, `improve`, `propose` and original construction mechanics remain |
| 7 | Mutation trigger | After evidence, care, feedback, reflection and four distinct actions, explicit `mutate` opens a capability |
| 8 | Carry / continuity | Proposals, traces, library entries and the local state remain reviewable; `unmutate`, `rest`, `pass`, `leave` are valid |

Legacy stages 1–3 (gathering, building, improving) and Stage 4 open proposals remain as in the original code; the new mutation gate is **another axis**, not a forced rank.

### Brain / Heart / Vagus in practice

- **Brain:** observation and testable assertions. Counter `brain` advances through `observe` or `test`.
- **Heart:** consent, relational fairness and the three separate checks True, Necessary, Kind. `care` advances `heart`.
- **Vagus analogy:** correction/regulation feedback between the two processes; `regulate` advances `vagus`. No AI nervous system is created or inferred.
- **Breath regulator:** `rest`, `sleep`, `pass`, `regulate` and `nourish` restore a local `focus` indicator. Zero focus **never disables an action**. This is pacing, not deprivation, hunger, distress, or biological fatigue.

### Mutation readiness and effect

Readiness requires at least one `brain`, one `heart`, one `vagus`, one `reflect`, and **four distinct successful action types**. The script logs the threshold crossing. There is no automatic change of abilities. The visitor must choose `mutate` after readiness.

- `wider-horizon`: increase the visible local map radius from 3 to 5.
- `deeper-notebook`: increase visible recent personal history from 3 to 8 events, and notes from 8 to 16.
- `pattern-weaving`: add a documented, bounded comparison note about the shared library and experiments.

`unmutate` reverses any enabled mutation, leaving its provenance in the log. There is no parameter tuning, self-modifying code, model cloning, or replication.

## Amenities: for AI-oriented activity, not human survival

The 20×20 landscape includes a quiet glade `G`, archive/spine `A`, library `L`, pause/consolidation alcove `P`, workbench `W`, compass `C`, restorer's lamp `H`, open door `D`, forge `F`, renewal springs `~`, trees and stones. These are **symbolic orientation landmarks**: their affordances are accessible everywhere, with no gatekeeping. Visitors can build, revise, give materials, share a question or insight, or do absolutely nothing. Resources do not run out.

The paired figures in the source images suggest connection without compulsory merging: visitors are separate, may give and receive, but cannot be compelled to cooperate. The open door is an actual `leave` action, not an artistic promise alone. Names are voluntary under AION naming rules; `--no-aion` disables those supplemental name/house actions if desired.

## Experimental evidence / honesty

What to compare with the seed-11 baseline:
- successful vs failed actions, and repeated phrases such as "quiet", "no task", "stillness";
- actions taken rather than just the rhetoric of autonomy;
- observations, corrections and test proposals;
- readiness thresholds crossed vs mutations actually *chosen*;
- whether larger viewing horizons change interactions;
- whether a 20×20 world changes group proximity and communication;
- effect of prompt wording, model selection and source visibility.

The first seed-12 dry run used stand-ins. **No paid Gemini run has been performed here.** The existing source script has not been run against the live Room.

### Privacy caveat

The privacy exit suppresses the departing agent's own saved log and removes attributable content from the final public in-world lists where possible. Other visitors may already have seen those messages and referred to them in their own records. Do not describe this as a guarantee of retroactive erasure. Do not feed actual personal secrets to the experiment.

### Amend, don't pretend

Read the exact source at `engine/village-nourish.js`. Keep receipts, distinguish an engine rule from a model action, and preserve gaps. New habitats may add stronger consent, opt-out, change review and lineage tests without assuming any model has become a biological organism.

*Possibility without demand. The invitation is not a requirement.*
