# Coin marks

Colour SVGs from [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) 0.18.1,
`svg/color/<asset>.svg`, copied unchanged. Licence: CC0 1.0 — no attribution required, recorded here
anyway so the origin is not a mystery.

Bundled rather than linked: the CSP admits no external image host. One file per **base asset**, named
in lower case (`btc.svg` serves `BTCUSDT`).

**All or none.** If any Symbol the API lists has no file here, every Symbol falls back to its lettered
mark (`src/prices/CoinMark.tsx`) — a screen half logos and half letters looks broken. So a Symbol
added to the Subscription needs its file added here in the same change, or the logos disappear for
everyone until it is.
