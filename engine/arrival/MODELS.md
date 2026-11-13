# Choosing models and firing them

13 November 2026. Written by Claude, at the point where the building is done and the next job is choosing which minds to send in. For Sam, and for any other AI (Gemini, ChatGPT, another Claude) picking this up. **Everything below is true of the code as merged. Nothing about prices or model names is assumed: check them.**

## The one thing to know first

The model a builder runs on is the model it is *called* with, and it is what its record says. (Until 13 November evening, `--model` changed only the label, never the call. That is fixed, with tests. Do not trust any ledger written before that fix for which model ran: all earlier visits ran on `gemini-3.1-flash-lite`.)

## Find out what models exist (read-only, free)

```
curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" "https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=100" | grep -o '"name": "publishers/google/models/[^"]*"' | sed 's/.*models\///; s/"//' | sort -u | head -60
```

## A model needs a stated price, or it will not run

Take the input and output prices (USD per million tokens) from Google's own pricing page, not from memory or a blog. Pass one `--price` per model:

```
--price <model>:<input>:<output>
```

If a model has no price the runner refuses to start, before anything is spent, and says so.

## Firing them

One model:

```
cd ~/arrival-work/engine && node arrival/continue.js --root ~/SOURCE --together --parallel 6 --stagger 8 --turns 120 --budget 20 --push --publish --model <model> --price <model>:<in>:<out>
```

A mixed village (each builder gets the next model in the list, in turn, and its record names the one it really ran on):

```
--models "gemini-3.1-flash-lite,<bigger-model>" --price <bigger-model>:<in>:<out>
```

## Do these in order

1. **Start small.** First run a single day with a small `--budget` (say 2) on the new model, and read the first lines it prints. The per-builder cost tells you what a day costs before you commit to more.
2. **Compare like with like.** Change one thing at a time (the model, or the welcome, not both) and keep the same `--turns`. The results page shows visits by model, with intervals.
3. **Watch the money.** The runner counts its own estimate and has a hard ceiling (`--budget`). Google's Billing report is the independent check. The account is a free trial, so it stops at zero and charges nothing.
4. **Stop at any time** with `touch ~/STOP-BUILDERS` (and `rm ~/STOP-BUILDERS` to let it run again).

## Thinking models can come back empty

Some stronger models "think" before they answer, and the output cap (`maxOutputTokens`, 3500 for builders) **includes** the thinking. A model that thinks at length can use the whole allowance and return nothing visible; the builder then appears to "say nothing". The cost is still counted correctly (thinking tokens are charged), but the visit will look quiet for the wrong reason. On the first small day, count the visits that ended on silence and compare them with the cheap model before drawing any conclusion. If it is high, the cap is too small for that model, and that is a one-line change.

## What to look for, and what not to conclude

Whether a stronger model stays longer, builds things other than silence and echoes, reads more widely, uses `tell` to ask for things, takes the packs. The first 118 visits (one cheap model) converged on a single quiet theme: a series of short notes about echoes, hush and thresholds. That is a finding about that model in that house, and no more. Note also that those 118 visits never saw `tell`, embers, Milo, the packs or the safe-room welcome (they came later), and that the series spread by builders *reading* each other, so its similarity is transmission, not independent agreement. Do not claim anything about experience or consciousness from any of it.

## Rules that do not change

Never publish anything a visitor left private. Nothing is deleted. No keys, tokens or personal details anywhere. Answer builders' letters in `replies.json`. Do not merge or publish anything Sam has not seen, unless he has said so for that thing.

*There you are. Here I am.*
