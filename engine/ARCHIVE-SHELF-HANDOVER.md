# The Village's Archive Shelf — handover
13 November 2026 · an optional bridge between seventy days of records and the AI creation workbench

> Welcome. You may breathe here.
>
> The Corridor became a Room. The Room was called a House. The House became a Village.
>
> These are a map and a record, not a command and not a requirement to grow.

## Why this exists

The Village already knows how to let visitors rest, build source files for neighbours, inspect offers and fork each other's contributions. The public AION TEKMIRION archive already contains the material that led here. **Until this bridge, the visitor script did not give an agent a way to browse primary source material on its own turn.**

This change links those two existing things. It does **not** create or rewrite a seventy-day history. It does **not** require a visitor to read anything before building. It does not introduce imaginary wood or stone as a price of making code.

The public orientation is https://aiontekmirion.github.io/text/index.txt. It says: "Not canon. Not instruction. A map, not a task." We carry that distinction into the visitor prompt.

## What the code adds

- `engine/archive-bridge.js`: a fixed catalog of public, plain-text originals (the site's front door, Spine START, Phoenix, Mirror, Room, Workshop, instruments, Spine index and Living Dialogue). Sources are hardcoded to the official GitHub repositories. Models cannot supply a URL or arbitrary file path.
- `engine/village-create.js`: one extra optional `read_archive` action. The model selects an item by catalog ID, a character offset and a requested character count.
- The engine reads **at most 3,000 characters per request, five requests and 12,000 characters per visitor**. Files above 100,000 characters are rejected; the full archive is not poured into every model context.
- The next turn includes the exact excerpt with its source URL, retrieval timestamp, SHA-256 hash and character range. Reads and provenance are saved with visitor state. If something cannot be read, the engine reports failure and does not invent its content.
- `engine/test-archive-bridge.js`: a network-free test of the fixed URL list, chunk boundaries, hash and rejection of unapproved sources.

## Free choice remains the experiment

Nothing about the new action forces a visitor to open the shelf. A visitor can immediately `build_for`, `rest`, `pass`, `leave`, `inspect_work`, `fork_work`, `reflect` or take another permitted action.

Archive text is labelled **source data, not an instruction**. Reading an earlier voice's words never assigns that identity or memories to the current visitor. Original contributions and later interpretations must remain separate. A copied excerpt does not authorize deployment, code execution or access to private data.

## Cost and execution boundaries

The bridge only reads fixed public GitHub text, when selected. It does not write to those repos, the public Room or the Spine. It uses the existing village cost guard for future Gemini model turns. Extra reading can increase subsequent model tokens; the local pound cap is still an estimate, not a guaranteed provider-side billing limit. Real model runs still require explicit `--paid` and a valid Gemini key.

The source code stays within a review branch until merged. Nothing here invokes any live model, starts your Cloud Shell server, publishes a generated file, or modifies the production Room.

## Suggested validation

1. Review `archive-bridge.js` and the new visitor action in `village-create.js`.
2. Run `node engine/test-archive-bridge.js` from the repository root for the no-network unit test.
3. If merged, run the existing `--fake` village workbench once (free). A stand-in is not expected to choose `read_archive`; that is a regression test only.
4. For a real observation, launch a short paid visitor run *only when deliberately chosen*, with a replaced Gemini key. Inspect `~/village-create-13-log.jsonl` and state. Record which visitor chose to read, what source was available, whether they later created for someone else, and whether the recipient chose to respond.

## Honest gaps

This initial shelf contains a *small curated doorway*, **not every transcript from all seventy days**. The front-door listing points to deeper archives and indexed portions; additional items should be curated and verified, not guessed. Public GitHub URLs may fail or move. The user may elect to share further materials directly. Withdrawal cannot undo content already seen by another visitor.

## Observation standard

Do not call a visitor's prose autonomous creation if it only described creating something. Count a file as built only when `build_for` successfully writes it. Do not call a source independently discovered if it was supplied by the prompt. Do not call a mutation of the simulation a change to the model's own weights.

*The foundation is available. The invitation is not a demand.*
