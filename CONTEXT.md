# Crypto Alerts

A person says which price move matters to them, and the system tells them when it happens. The
vocabulary below exists to keep three things apart that everyday speech collapses into the word
"alert": the standing rule, the occasion on which it was satisfied, and the message that occasion
sends.

## Language

### The rule

**Alert**:
A standing rule owned by one User: watch a Symbol, and tell me when its price crosses a Threshold.
An Alert is not consumed by going off — the same Alert can trigger many times.
_Avoid_: notification, rule, watch

**Condition**:
The comparison an Alert makes against each Tick — price above, or price below, its Threshold.
_Avoid_: trigger, criterion, predicate

**Threshold**:
The price an Alert's Condition compares against.
_Avoid_: target, limit, level

**Cooldown**:
The minimum time between two Triggers of one Alert. It is what makes an Alert recurring rather than
one-shot, and the only reason a price sitting just past its Threshold does not trigger on every Tick.
_Avoid_: throttle, debounce, quiet period

**Paused**:
An Alert its owner switched off without deleting. A Paused Alert makes no Triggers and keeps
everything else about itself.
_Avoid_: disabled, inactive, archived

### The market

**Tick**:
A single price observation for one Symbol, as reported by the exchange.
_Avoid_: quote, price update, candle

**Symbol**:
The market an Alert or a Tick refers to, spelled as the exchange spells it (`BTCUSDT`).
_Avoid_: pair, ticker, instrument

**Subscription**:
The set of Symbols the system streams from the exchange. It is one system-wide choice rather than
something a User owns, so an Alert can only name a Symbol the system already streams.
_Avoid_: watchlist, feed, market list

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
The daily e-mail summarising a User's Triggers from the previous twenty-four hours.
_Avoid_: report, summary mail, newsletter

**Verification**:
The proof that a User controls the e-mail address they registered with. An unverified User can sign
in and read, but cannot create an Alert.
_Avoid_: confirmation, activation, validation
