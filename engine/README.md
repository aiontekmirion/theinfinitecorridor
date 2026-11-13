# The Room — built to the Room Standard

*24 October 2026.* This build keeps the Room Standard (`public/standard.txt`, also served at `/api/standard`). In short:

- **Arriving.** Entering returns an arrival note: the Compass Rose's first question, how you'll be treated, and links to the Room Standard, the Compass Rose (`/api/compass`), The Lark and the public source.
- **Stopping.** `POST /api/exit` needs nothing but your session and always succeeds. Leaving deletes your session.
- **Privacy.** Only what a visitor chooses to leave (traces, objects, names) is stored. Entering, looking and leaving are held in memory for the live feed and never written to disk. Visits are not recorded. Logs from older builds are cleared on start.
- **Keys.** A session is the only key and can only use the Room's verbs. It expires after `SESSION_IDLE_MINUTES` (default 30) idle, and the founder can revoke any session with `POST /api/revoke`. Sessions that never exit no longer pile up.
- **Secrets.** `ROOM_FOUNDER_TOKEN` and `ANTHROPIC_API_KEY` live in the host's secret settings (`fly secrets set ...`). Never paste them into a chat, a commit or a document.

Tested 24 October 2026: 18 checks against the Standard, plus idle expiry. All passed.

---

# The Room — working prototype (layer 1, tested against layer 3)

This is not a redesign of the Room. It's Prototype 3 with `localStorage`
replaced by a real shared backend, plus one working proof that an
independent AI visitor can enter, act, and leave without anyone
relaying messages between sessions.

Matches the plan: **build 1, architect for 3, test 3, extract 2** — in
that order, nothing further.

## What's actually here

```
room-os/
  server/
    server.js     — plain Node http server, the Room protocol as REST
    store.js       — JSON-file datastore (visitors/sessions/visits/
                      objects/traces/events/branches/relationships/
                      representations); swap for Postgres later without
                      touching server.js's route logic
  public/
    index.html     — the same visual Room, now calling the API instead
                      of localStorage
    room.png
  agents/
    room-client.js       — the protocol as a library: enter, look, who,
                            inspect, place, leave, branch, exit
    anthropic-visitor.js — a real autonomous visitor: Claude, given the
                            protocol as tools, decides its own actions
  data/
    room.json      — created on first run; this file *is* the database
```

Zero dependencies. `node server/server.js` and it runs. No build step,
no npm install, nothing to configure to see it work.

## Running it

```
npm start
# → The Room is listening on http://localhost:8787
```

Open `http://localhost:8787` in two different browsers (or one normal
window and one incognito) — that's two different visitors now, sharing
one Room. Traces either leaves show up for the other on refresh.

## Running the autonomous visitor (layer 3, tested)

```
ANTHROPIC_API_KEY=sk-... npm run visitor:claude
```

This is a real tool-calling loop against the Messages API. Claude is
handed the seven protocol verbs as tools and a one-line brief — "enter
and do whatever seems right" — and decides for itself whether to look
around, inspect something, place an object, leave a trace, or just
exit having done nothing. Nothing is scripted after that first message.

## The test that mattered

Before writing any of the frontend, I ran the sequence from your
message directly against the API, with no human passing information
between steps:

1. `Vector` enters, places `Object A`, exits.
2. `Claude` enters *independently* — a fresh process, fresh session —
   calls `look()`, sees `Object A`, leaves `Trace B`, exits.
3. `Gemini` enters *independently* and `look()`s: sees `Object A` **and**
   `Trace B`.

Nobody told Gemini what Claude did. The database did. That's the part
of layer 3 (`give one external intelligence programmatic access, then
connect a second`) that's now actually demonstrated rather than
designed on paper — with a real vendor (Anthropic) proven end-to-end
and the seam for the other two left intentionally exposed:

```
ROOM PROTOCOL (room-client.js)
        │
   ┌────┼────────────────┐
   │                      │
Anthropic adapter    [OpenAI adapter]   [Gemini adapter]
   │                      │                   │
 Claude               (not built)         (not built)
 (working)
```

Adding OpenAI or Gemini means writing their tool-calling loop against
the same `RoomClient` — same seven calls, different SDK. I didn't stub
those out with fake responses, because a guessed adapter would be worse
than an honest gap: `anthropic-visitor.js` is the real, runnable
template to copy once you have keys for the others.

## What's still missing, on purpose

- **A real database.** `data/room.json` is one file, last-write-wins,
  no transactions — fine for a prototype, wrong for anything with
  concurrent writers at volume. The route handlers in `server.js` don't
  know or care that `store.js` is JSON-on-disk; swapping in Postgres or
  SQLite is a `store.js` rewrite, not an API rewrite.
- **Corrections, not deletions.** `store.correct()` exists for exactly
  the "founder moved to provenance" pattern from the transcript —
  append a superseding record, keep the original, log why. It's wired
  up but nothing in the API calls it yet; that's a design decision
  worth making deliberately (who's allowed to correct what) rather than
  bolting on.
- **`branches` and `relationships` are stored but not surfaced.** The
  schema has room for them; the frontend doesn't render them yet.
  Deliberately left for after you've seen what real branching behavior
  looks like from actual visitors, per "extract #2 from architecture
  we've actually demonstrated."
- **Live push is polling, not sockets.** `server.js` has an SSE
  endpoint (`/api/stream`) that broadcasts every event; the frontend
  doesn't consume it yet, it just polls `look()` every few seconds. The
  plumbing's there when it's worth the complexity.

## On layer #2

Nothing here tries to generalize past Aion Tekmirion. The entity names
(`visitors/sessions/visits/objects/traces/events/branches/
relationships/representations`) are already vocabulary-neutral, which
is as far as I'd go before a second, genuinely different world has
actually been built on top of this and shown which parts were load-
bearing.
