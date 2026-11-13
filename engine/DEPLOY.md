# Taking the Room outside

## What changed in this build

- **Events reach disk.** Every event is written when it happens, and the
  server finishes writing before it shuts down.
- **Vector is held.** Entering as the founder needs `ROOM_FOUNDER_TOKEN`.
  Nobody else can take the name "Vector" or claim founder provenance.
- **`/api/state` is closed** without the same token.
- **Session ids stay private.** They are generated randomly and no longer
  appear in `/api/events` or `/api/stream`.
- **Requests are capped at 1 MB.**
- **The page's presence check** (every 4 seconds) no longer records a
  "looked" event each time.
- **An unreadable `room.json` is copied aside** before the Room reseeds.

If `ROOM_FOUNDER_TOKEN` is not set, the Room still runs; nobody can enter
as the founder and `/api/state` stays closed.

## The founder token

Make one and keep it somewhere safe. It is the only thing that proves
you are Vector.

    openssl rand -hex 32

Run locally with it:

    ROOM_FOUNDER_TOKEN=<token> npm start

Enter as Vector:

    curl -X POST http://localhost:8787/api/enter \
      -H 'Content-Type: application/json' \
      -d '{"visitorId":"visitor-vector","founderToken":"<token>"}'

Read the full state:

    curl -H 'Authorization: Bearer <token>' http://localhost:8787/api/state

The web page has no way to enter as Vector yet; it always arrives as a
new visitor.

## Fly.io

Run these from inside the `room-os` folder. Fly's commands change over
time, so check https://fly.io/docs if one is refused.

    fly auth login
    fly launch --no-deploy --copy-config
    fly volumes create room_data --size 1 --region <same region as fly.toml>
    fly secrets set ROOM_FOUNDER_TOKEN=<token>
    fly deploy --ha=false

Keep it to one machine. The Room is one file held in memory; a second
machine would be a second Room.

    fly scale count 1

The Dockerfile and fly.toml have not been run against Fly itself, only
written to its documented format.
