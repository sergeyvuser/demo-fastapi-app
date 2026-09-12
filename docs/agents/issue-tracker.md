# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

`.scratch/` is listed in `.gitignore` — tickets stay local and are never committed.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/impl/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file

### Two numbering namespaces, deliberately kept apart

A real tracker hands out globally unique ids, so nothing there can collide. Here the agent assigns the number, and **two skills write tickets into the same feature directory**: `/wayfinder` writes the decision tickets it works through, and `/to-tickets` writes the implementation tickets derived from the spec afterwards. Both number from `01`.

They therefore get separate directories, and a bare number is never enough to name a ticket:

| Written by | Path | Referred to as |
| ---------- | ---- | -------------- |
| `/wayfinder` | `.scratch/<feature-slug>/issues/<NN>-<slug>.md` | "wayfinding ticket NN" |
| `/to-tickets` | `.scratch/<feature-slug>/issues/impl/<NN>-<slug>.md` | "impl NN" |

An implementation ticket's `Blocked by:` line refers only to other implementation tickets. Where it needs to cite the reasoning behind a decision, it links the wayfinding ticket by relative path rather than by number.
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading
- Write these files in English, like the rest of the repo's docs

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins. Do not descend into `issues/impl/` — those belong to `/to-tickets` and are not part of any map.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
