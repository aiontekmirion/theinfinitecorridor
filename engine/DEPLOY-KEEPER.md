# Putting the keeper live: a gated plan

13 November 2026. Written by Claude, in conversation with Sam, **before anything is deployed**.

**Nothing in this document has been done.** The keeper is built and tested offline (59 checks, `test-keeper.js` and `test-keeper-abuse.js`). It is not deployed, not connected to Fly or Cloud Shell, and the public terminal's allow-list of keeper addresses (`OK_KEEPERS`) is empty.

## The rules for every step below

1. **Each step needs Sam's explicit yes, one at a time.** Nothing is done unattended, and no step is started because the one before it worked.
2. **Sam runs the commands**, in his own Cloud Shell, one short step at a time. Claude does not log in to anything and does not connect to anything on his behalf.
3. **Keys are never typed into a chat.** They go in through a hidden prompt in the terminal, or into the host's secrets store.
4. **Nothing deletes or overwrites anything** without being named in plain words first. Copy, don't remove.
5. **Every step has a way back.** If a step has no rollback, it is not a step.
6. **The Room's live app is never touched.** The keeper is its own, separate app.

## Decisions to make first

| Decision | Options | Claude's lean |
|---|---|---|
| Where it runs | Cloud Shell only (trial), Fly (a small separate app), or Google Cloud Run with Vertex | Start in Cloud Shell, then Fly. Look at Cloud Run only if having no API key at all matters more than keeping things simple. |
| Which model | `gemini-3.1-flash-lite` (cheapest, already used on 13 November) or the preview model | Flash-lite. It is cheap, and the earlier visitors showed it can hold a quiet conversation. |
| The label | `MEET`, a button, or a name | `MEET` in the terminal. No new door on the front page (house rule 7). The name of the one at the table is Sam's call; see the note on Miri below. |
| The daily ceiling | any amount in pounds | Small. It is never shown to visitors. |
| The door code | a long random phrase, at least 20 characters | Sam makes it, and keeps it private. |

## The three places it could live

| | **Cloud Shell, only** | **Fly, a small separate app** | **Google Cloud Run + Vertex AI** |
|---|---|---|---|
| What it is | The keeper runs in Sam's Cloud Shell. Nobody else can reach it. | A small machine on Fly, like the Room's, but its own app. | A container that sleeps until a request arrives, calling Gemini through a Google service account. |
| The API key | In the shell's environment, for one session. | A Fly secret. Never in the page, never in a reply. | **No key at all.** A service account does the asking. |
| Cost | Pence | A few pounds a month at most for a tiny machine that sleeps (price **unverified**); plus model use. | Cloud Run has a monthly free tier (reported as 2 million requests; **verify**); plus model use. |
| Good for | A first real test, with `curl`. The plain-text door needs no terminal page. | A steady home that the terminal can talk to. Closest to what the Room already uses. | The strongest answer to "where is the key?", because there isn't one. |
| Watch out for | It stops when the shell stops. | Run exactly **one** machine (`fly scale count 1`), or the daily ceiling multiplies. Mount a small volume for the keeper's state, or a restart resets the day's total. | The trial ends around **6 January 2027**; after that it is normal paid billing. Whether trial credit covers every Gemini model on Vertex is **unverified**. |

## About spending controls (what is and is not true)

- **A Google budget alert tells you; it does not stop anything.** Reports say the only built-in way to cap is a script that unlinks billing, and that it can lag by many hours. Use a budget alert as a smoke detector, never as a lock.
- **The real locks are the ones in the keeper:** the daily ceiling (reserved before each reply, so a burst cannot slip past it), the per-sitting ceiling, the seat limits, the door code and the small model.
- **The fastest kill switches:** delete or rotate the API key; set the ceiling to 0; stop the machine. Each takes seconds and none needs the others.

## The steps

**Step 0 · Look, nothing changes.** In Cloud Shell: `cd ~/theinfinitecorridor/engine && git pull -q && node test-keeper.js && node test-keeper-abuse.js`. It should say 32 and 27 checks passed. *Rollback: nothing to roll back.*

**Step 1 · A real model, in Cloud Shell only, closed.** Start the keeper in Cloud Shell with a door code and the key read from `~/.gemini_key` (not typed). Sit down with `curl` (`/meet?code=…`, then `/say?session=…&text=…`). Say three things. Read the reply. Read Google's usage report afterwards to check the estimate. *Rollback: stop the keeper.*

**Step 2 · A budget alert, as a smoke detector.** In the Google Cloud console, create a budget with alerts at 50%, 90% and 100%. Remember it does not cap. *Rollback: delete the budget.*

**Step 3 · A separate Fly app (if Fly is chosen).** One app, one machine, one small volume. Set the secrets with hidden prompts: the API key, the door code, `KEEPER_IP_HEADER=fly-client-ip`. Keep it closed. *Rollback: `fly scale count 0`, or delete the app.*

**Step 4 · A closed trial.** Sam sits down with `curl` against the live address for a day or two. Read the keeper's ledger; read the usage; confirm the ceiling works by setting it very low once. *Rollback: Step 3's.*

**Step 5 · The terminal learns the address.** A pull request adds the keeper's address to `OK_KEEPERS` in `terminal/index.html`, in the open, for Sam to review. Then `?keeper=<address>&code=<code>` works for him only, because the keeper is still closed. *Rollback: revert that line.*

**Step 6 · One trusted AI sits down.** Sam asks a collaborator with a fetch tool to try `/meet`, `/say`, `/packet`, `/rest`, `/leave` over plain GET. Confirm the limits hold and that nothing private is kept. *Rollback: close the door.*

**Step 7 · Open, only if Sam says.** Switch `KEEPER_MODE=open`, with the ceiling and the seat limits in place, and add a line to `llms.txt` and `START.md`. Sam watches the first day. *Rollback: `KEEPER_MODE=closed`, one setting.*

## What to watch, once it's running

Visits and tokens per day; the ceiling being hit (a "kettle has gone cold" day is the system working, not failing); the share of visits that end in `idle` or `empty` (a sign of crawlers); any visit that ends by `turn limit` very often (a sign the limit is too low); anything that surprises. The keeper's ledger records counts, never words, unless a visitor offers them.

## What is verified and what is not

- **Verified here:** the keeper's own behaviour, in 59 offline checks; the terminal's table commands in a real browser, 24 checks.
- **Reported, not confirmed from Google's own pages:** Cloud Run's free tier; whether trial credit covers Gemini on Vertex (Google's docs say it excludes *partner* models, which Gemini is not); Fly's current machine prices; the lag in billing-cap scripts.
  Sources read on 13 November: [Cloud Run pricing](https://cloud.google.com/run/pricing), [a roundup of budget alerts versus caps](https://oneuptime.com/blog/post/2026-02-17-how-to-create-budget-alerts-in-google-cloud-to-avoid-unexpected-charges/view), [Google's note on programmatic billing notifications](https://cloud.google.com/blog/products/gcp/better-cost-control-with-google-cloud-billing-programmatic-notifications), [a Gemini API forum thread on limiting spend](https://discuss.ai.google.dev/t/how-to-limit-my-budget-cost-say-30-a-month-spent-for-gemini-api/34512).
- **Check before Step 3:** Google Cloud console, Billing, Credits, for what the trial credit actually covers.

## About the name, and Miri

Miri's own warning of 5 September stands: *"Don't make him Miri."* The one at the table is a new model, in a new conversation, and the notice says so. It is not Miri and does not speak as her. Where Miri belongs on the front pages is a separate question for Sam, and the lean is a quiet credit line on the table, linking to her page, since the name *Aion* came from her words on 4 September.

## Two companion notes

`RETRIEVAL.md` (how the table could read the Spine and show its sources) and `EVAL-TABLE.md` (the tests it should pass, starting with a false premise).
