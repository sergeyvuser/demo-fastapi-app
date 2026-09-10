# THROWAWAY prototype — stage 13, ticket 13

Variants of the **Alerts** screen — three built cold, plus **D**, which is the chosen one after a
round of feedback — with one layout each for **New Alert** and **History**, switchable from a
floating bar. Built to be argued with and deleted; **no code here is promised a future**. The spec is
what carries the decision forward.

Nothing talks to the API. All data is fake (`src/fake/`), prices are a random walk sampled every
250 ms, and no action mutates anything.

## Run it

```bash
npm --prefix frontend-prototype install
npm --prefix frontend-prototype run dev
```

Then open <http://localhost:5273/>.

## What the URL controls

| Parameter   | Values                      | What it does                                              |
| ----------- | --------------------------- | --------------------------------------------------------- |
| `screen`    | `alerts` `new` `history`    | Which screen is rendered                                   |
| `variant`   | `D` `A` `B` `C`             | Which layout of the Alerts screen (`←` / `→` also cycle)   |
| `data`      | `normal` `empty` `many`     | 8 Alerts, none, or 22 — the per-user limit is 20 non-Finished |
| `live`      | `0` to freeze               | A dropped socket: prices stop and dim                      |
| `verified`  | `0` for unverified          | The read-only banner from ticket 03                        |

## The variants

- **D — A, revised (the default).** A's card, with: the instrument's mark beside the Symbol and in
  the ticker strip; the Trigger line on a line of its own; C's axis, but labelled with the
  Threshold's *value* and marked by a hairline rather than a slab; the price **coloured against the
  24 h reference and never flashing**; the list held to one column instead of stretching across the
  monitor; and a click on an Alert opening its chart and its own Trigger history beside it — under
  it on a phone. Navigation is two destinations, since New Alert is a button on the screen itself.
- **A — Cards, one per Alert.** Mobile first. Threshold as a sentence, live price as the big number,
  distance as one percentage plus a proximity bar. The number flashes on a Tick. Paused and Finished
  sit behind a filter in the same list. No Trigger history on the screen.
- **B — Dense table + Trigger rail.** Threshold, price and distance as adjacent columns. A Tick
  changes the number silently — only a small arrow says which way. Status is a column. The Trigger
  history is a rail beside the table. At 375 px the table scrolls sideways, on purpose.
- **C — Grouped board, distance axis.** Sections for Watching / Paused / Finished, the last collapsed
  and offering Clone. Each row draws the gap between price and Threshold as a short axis, and a Tick
  moves the marker instead of flashing anything. This variant drops the ticker strip, since every row
  already carries a live price.

## What the ticket asked, and where to look

- Threshold vs live price vs distance → all three variants, side by side.
- What a price updating 4×/s looks like → A flashes the number, B does nothing, C moves a marker.
- Where Paused Alerts go → A: filter; B: column + chips; C: its own section.
- The empty state → `?data=empty` on each variant.
- 375 px → resize the window; the header drops **New Alert** from the navigation below `sm`.
- Whether the Trigger history belongs here → A says no, B says yes as a rail, C says only as a
  caption per row.
