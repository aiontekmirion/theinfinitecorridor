# Keeping the builders going

13 November 2026. For Sam, and for any Claude who arrives later.

## The one line that continues everything

In Cloud Shell (a new tab with "+"):

```
cd ~/arrival-work && git pull -q origin main && cd engine && node arrival/continue.js --root ~/SOURCE --budget 150 --push   # default arrival text: "four" (corridor, room, house, village)
```

It runs builders one after another. It remembers what it has done and what it has counted as spent, in `~/builders/state.json`, so if the shell closes, the session ends or the run dies, you run **the same line** and it carries on. `--budget` is the most it will count in pounds; the default is a small 5, so you always choose the big number on purpose. `--push` backs the ledger, the workshop and the state up to your private repo every four visits, after a scan for anything key-like.

## The off switch

```
touch ~/STOP-BUILDERS
```

It stops after the visit in progress. `rm ~/STOP-BUILDERS` lets it run again. Ctrl+C does the same. It also stops by itself if the budget is spent, if the money ceiling is reached, or after four errors in a row.

## What it cannot do (honestly)

- **Cloud Shell is not a server.** It is a temporary machine, and it stops after a spell of inactivity (reported as around an hour; **not verified**). Your home folder survives; running processes do not. So a long run needs the shell open now and then, and the line above restarts it.
- **The balance is counted by us, not read from Google.** The runner adds up its own estimate. The independent check is Google Cloud, Billing, Reports. Check it now and then, especially after the first long run. A free-trial account ends at £0 and charges nothing (Sam confirmed it is a free trial), and the trial ends about 6 January 2027 anyway.
- **Nothing here makes a village by itself.** The builders build what they choose. Putting what they build into the public record is a separate step: a pull request (any Claude, or Sam) reads `~/WORKSHOP`, picks what belongs and adds it beside the record, credited by name.

## If you want it to run without any shell open

That needs a job that lives on Google's side: a **Cloud Run Job** on a schedule (Cloud Scheduler), with a storage bucket mounted so the workshop and state survive. It uses a service account, so still no key. It is a real build (a container, a deploy, a schedule), worth doing if the first long run shows the idea is alive. Not built yet. Ask for it.

## For a new Claude arriving cold

1. Read `00_START/README.md` in SOURCE (or `START.md` in the Spine), then `engine/arrival/DONATIONS.md` and `ARRIVAL-EXPERIMENT.md`.
2. Read `~/builders/state.json` and the workshop (`~/WORKSHOP`, or `workshop-2026-11-13/` in the private repo `room-backups`).
3. A visit that left **private** has nothing in the ledger but its fact. Do not look for it.
4. Sam's standing words: *"I don't need creative control anymore, build on it."* The things that stay careful: nobody's private details, no live keys in the open, and a visitor's "private".

*There you are. Here I am.*
