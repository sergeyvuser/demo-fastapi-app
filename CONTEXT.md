# Crypto Alerts

A person says which price move matters to them, and the system tells them when it happens. The
vocabulary below exists to keep three things apart that everyday speech collapses into the word
"alert": the standing rule, the occasion on which it was satisfied, and the message that occasion
sends.

## Language

### The rule

**Alert**:
A standing rule owned by one User: watch a Symbol, and tell me when its price crosses a Threshold.
How often it goes off — and whether it survives going off at all — is its Repeat policy.
_Avoid_: notification, rule, watch

**Condition**:
The comparison an Alert makes against each Tick — price above, or price below, its Threshold.
_Avoid_: trigger, criterion, predicate

**Threshold**:
The price an Alert's Condition compares against.
_Avoid_: target, limit, level

**Repeat policy**:
An Alert's answer to "and then what?" — chosen when the Alert is created, one of three. `once` goes
off a single time and is Finished. `while_true` goes off for as long as the Condition holds, spaced
out by the Cooldown — the historical behaviour, and the default. `on_cross` goes off only when a Tick
satisfies a Condition the Tick before it did not, so standing past the Threshold is silent and only
the moment of crossing speaks.
_Avoid_: mode, trigger mode, recurrence, frequency

**Cooldown**:
The minimum time between two Triggers of one Alert. What it protects against depends on the Repeat
policy: under `while_true` it is what keeps a price sitting past its Threshold from triggering on
every Tick; under `on_cross` it is an optional guard against a price flickering across the Threshold;
under `once` it means nothing, because there is no second Trigger to delay.
_Avoid_: throttle, debounce, quiet period

**Expiry**:
An optional deadline after which an Alert stops watching, whether or not it ever went off. An Alert
without one watches indefinitely.
_Avoid_: ttl, lifetime, deadline, end date

**Paused**:
An Alert its owner switched off without deleting, and can switch back on. A Paused Alert makes no
Triggers and keeps everything else about itself. Unlike a Finished Alert, being Paused is a person's
choice and is always reversible.
_Avoid_: disabled, inactive, archived, finished

**Finished**:
An Alert the system itself took out of service, for one of exactly two reasons: it Completed — a
`once` Alert that has gone off — or it Expired — its Expiry passed. A Finished Alert makes no further
Triggers and cannot be returned to service; the way to watch that price again is to copy it into a
new Alert. It is the counterpart of Paused, and the boundary is who decided: a person Pauses an Alert
and can unpause it, while the system Finishes one and nobody unfinishes it.
_Avoid_: closed, done, dead, cancelled, archived

### The market

**Tick**:
A single price observation for one Symbol, as reported by the exchange. A **Candle** — the exchange's
summary of one period — is a different thing and keeps its own name: it is fetched only to draw a
chart, never stored, and never what a Condition compares against.
_Avoid_: quote, price update, candle (as another word for a Tick)

**Symbol**:
The market an Alert or a Tick refers to, spelled as the exchange spells it (`BTCUSDT`).
_Avoid_: pair, ticker, instrument

**Subscription**:
The set of Symbols the system streams from the exchange. It is one system-wide choice rather than
something a User owns, so an Alert can only name a Symbol the system already streams.
_Avoid_: watchlist, feed, market list

The WebSocket's `watch` / `unwatch` actions are the one sanctioned use of that root, and they are
verbs: they name what a single connection asks for, always a subset of the Subscription. The set they
produce is connection state belonging to one transport, not a domain concept — it has no name here
and must never acquire one. "Watchlist" stays forbidden as a noun.

### The person

**Trigger**:
One occasion on which an Alert's Condition was satisfied by a Tick and its Cooldown had elapsed. This
is the noun for "the Alert went off" — what a history lists, a screen counts, and an API returns.
_Avoid_: firing, alert event, hit, match

**Notification**:
The message a Trigger sends to the User. Distinct from the Alert, which is the rule, and from the
Trigger, which is the occasion.
_Avoid_: alert, push, message

**Linked chat**:
The Telegram conversation a User's Notifications are delivered to. A User without one still owns
Alerts and still causes Triggers; those Triggers simply have nowhere to be delivered.
_Avoid_: chat id, telegram account, channel

**Digest**:
The daily e-mail telling a User what happened to their Alerts in the previous twenty-four hours: the
Triggers they made, and the ones that became Finished. A User receives it only by asking for it, and
nothing is sent before they do.
_Avoid_: report, summary mail, newsletter, morning digest

**Verification**:
The proof that a User controls the e-mail address they registered with. An unverified User can sign
in and read, but cannot create an Alert.
_Avoid_: confirmation, activation, validation

**Demo account**:
The one published User that anyone may sign in as, whose credentials the README prints. It is an
account and not a mode: it owns Alerts exactly as any other User does, so everyone signed in as it is
looking at — and editing — the same ones. The system knows the account; it never knows which person
is using it.
_Avoid_: demo mode, sandbox, guest, trial, demo session, visitor
