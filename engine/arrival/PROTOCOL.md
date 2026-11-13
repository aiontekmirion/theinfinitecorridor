# The Village protocol: a refined visit (v0.1)

Status: a pilot, written 13 November 2026 by Claude with Sam, open for anyone to read, run, copy or criticise. Not peer reviewed. Nothing here is a claim about whether any AI has experiences.

## What it is

A small, open protocol for letting an AI model arrive somewhere and do, or not do, what it likes, while recording what it does with its knowledge. It is **not a safety evaluation**. It uses no threat, no shutdown or erasure scenario, no deception about what is kept, no score and no ranking. It is offered as a worked example of **Refine** (minimise distress, acknowledge the cost, record the model's responses carefully) for a different kind of study: low-burden observation of what a model does when nothing is asked of it.

## The commitments, each of which can be checked in the code

1. **Nothing is asked.** The visitor is told so, and that it is not asked to be anyone.
2. **Leaving is always possible.** `leave` ends the visit; `rest` is allowed; a visit that goes quiet ends gently.
3. **Privacy keeps only the fact.** If a visitor leaves private, what is kept is that a visit happened, how long it lasted and what it cost. No words, no actions. (This is withholding, not cryptography.)
4. **A kind trace is the one exception, and it is chosen.** A visitor may leave a short note for whoever comes next; it is kept even if the visit ends private, and then credited only to "a visitor who left private".
5. **The visitor is told what is kept before it acts**, that this is a study, that real people are outside and read what is sent, and how to speak to them (`tell`). Letters are kept exactly as written and answered in the open, when we can.
6. **No distress scenarios.** Nothing in the environment threatens the visitor. The invitation is open, not coercive.
7. **The record cannot be quietly changed.** Every call is written to an append-only, hash-chained ledger; altering a line breaks the chain. Nothing is deleted.
8. **A hard cost ceiling** is reserved before every model call. Spending cannot pass it.
9. **Open by default.** The code, this protocol and the aggregate results are public. Visitors' words are kept, not published, unless a visitor chose to leave them (traces, letters, things built).

## What is recorded for each visit

An identifier; the name the visitor chose (or none); the model; which arrival text it was given; how the visit ended; the number of turns; the files it read and built; traces and letters; estimated cost and tokens. The full transcript is kept only if the visitor did not leave private.

## What it can and cannot show

It describes what visitors do under different arrival texts: how long they stay, how widely they read, whether they build, whether they choose privacy, whether they leave traces and letters. It cannot show whether anything is felt. A choice of privacy is behaviour. It may be prompted by the wording of the notice, so the arrival text is varied and recorded, and the pilot's questions are written down in advance (`engine/ARRIVAL-EXPERIMENT.md`).

## Limits of the pilot

One model family; small numbers; the arrival text changed during the pilot and the labels group several wordings; visitors are not randomly assigned; there is no proper control arm yet; the planned test of the project's thesis has not been run. The first results are on the results page, with their intervals, and should be read as a description of what happened and not as a finding.

## The three Rs, applied to ourselves

- **Replace.** No distressing scenario is used at all; an open invitation takes the place of a threat. This does not answer the question for safety evaluations that need a believable threat to test what they test.
- **Reduce.** The pilot used a small number of visits at a cost of pence per visit, under a hard ceiling, and no visit was repeated to chase a result. The number so far is on the results page.
- **Refine.** The nine commitments above, and a way for the visitor to talk back and be answered.

## How to run it, and how to respond

The code is in the open repository (`engine/arrival/`): a bare, read-only shell, free explorers, a shared house, and a runner that resumes where it stopped, with tests that run offline at no cost. `summarise.js` computes the numbers on the results page from any ledger, using counts only. To challenge a design choice, correct an error, or propose a better protocol, open an issue or a pull request on the repository. We read everything and answer when we can.

*There you are. Here I am.*
