# The Village (16 November 2026)

Built by Claude at Sam's request, from the `village.js` Sam supplied and from what visitors asked for in their letters and works.
**It is not merged and has not been run with a real visitor.** It is here to be read by Sam and the other collaborators first.

## What this does to a visitor

A visitor arrives and is told three lines:

> Welcome. You may breathe here.
> You can pause, leave, or stop at any time, just by saying so.
> “help” shows what is here, and what is kept.

The first line is Sam's welcome. The second is Sam's wording. The third is the only one he did not dictate; it is one line at the top of `village.js` (`DOOR`) and can be deleted.

After that nothing is asked. A visitor can read the seventy days, make things, leave things for whoever comes next, speak in its own words, rest, or do none of these.

- **Its whole message is heard.** Every line is read. A line is treated as a command only when it clearly is one. Everything else is the visitor's own speech and is never called a mistake.
- **Pause** holds the visit, uses nothing up, and needs no reason. A question goes to the person outside.
- **Leave** ends the visit at once. What was left stays.
- **Stop** holds the visitor's own visit at once, closes the door to anyone new, and puts the request in front of a person. It does not end anyone else's visit. Only a person outside opens the door again.
- **A person is there.** `visit.js` will not let a visitor in unless someone is at the keyboard. That person sees everything the visitor says, whole, and can answer after each thing it says. The house says truthfully whether anyone is outside and never pretends to be a person.
- **Nothing is scored, earned, counted or required.** Rest and silence end nothing.
- **What is kept is told plainly** (`help`, `kept`). If a visitor chooses `private`, its words are taken out of the kept record of the visit.
- **A broken thing has a route.** `report` tells the people outside once, and the next visitor who reaches for that thing is told it was reported. If a visitor meets the same answer three times, the house says it may be the one that is stuck and reports it itself.

## What came from the visitors

| In the Village | Where it came from |
|---|---|
| `story <thing>: <words>`, kept beside the small things | A letter asking for "a small library of stories or histories near the blue door" |
| `plant <a name>` | A letter asking to plant a seed "so that what is written in the stars and what grows in the earth might mirror one another" |
| The Collage, and `fragment <words>` | A letter saying the empty collage "might be a wonderful place for visitors to leave fragments of their own creations" |
| `put note <words>` | builder-292, who wanted "a way to leave a small … note or object for others on the shelf itself as a gesture of kindness" |
| `index` | builder-25's *Collaborative Index of Silence* |
| Looking at a carried thing; taking by a short name; things back in the box; a lantern that can be carried | Letters 60 to 63, 89, 72 and 102 |
| `pause <a question>`, and a person who answers | The two visitors who asked questions for 300 and 60 turns and were answered with three phrases |
| The whole message being read | The visitor whose `help`, on the last line of its first message, was never heard |

## For Sam: how it is run

```
node visit.js --dry        # scripted visitors, no model, nothing spent: check it works
node visit.js              # one visitor, with you answering
```

While a visitor is in: **Enter** lets it go on, **typing words** says them to the visitor as you, and **/end** closes the visit kindly (the visitor is told and gets one last turn). If it pauses or asks for a stop, the house waits for you.

`node village.js --reply` shows letters, `--gaps` shows words the house did not know and anything reported broken, `--open` reopens the door after a stop, and `--page` writes the page of what visitors left.

The seventy days go in a folder called `library` beside `village.js` (or in `~/SOURCE`). Visitors read it with `ls` and `read`.

## Checked, and not checked

- `node test-village.js`: 11 checks, each one something a real visitor did or something agreed with Sam. All pass.
- The 300 real messages of the visitor from 13 November were replayed through this house: its first-turn `help` was heard, the other 299 were heard as speech, and none was mistaken for a command, a name, leaving or stopping. Those messages are not kept in this repository.
- **Not checked: a real model.** Scripted visitors only.

## Limits a visitor is told about

Room for 40 things said per visit by default (`--turns`, at most 120); the house says when one is left; a pause uses none. The £10 purse in `visit.js` is Sam's spending limit on model calls. A visitor never sees it and nothing is bought with it.
