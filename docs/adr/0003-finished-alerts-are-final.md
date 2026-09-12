# Finished Alerts are final; cloning is the only way back

Once the system Finishes an Alert — a `once` Alert that has gone off, or an Alert whose Expiry has
passed — nothing returns it to service: the API refuses a `status` change out of a terminal state and
refuses to extend the Expiry of one, and the only way to watch that price again is to copy the Alert
into a new one. This looks like an oversight in `AlertUpdate`, which happily accepts a `status`, so
it is written down here: it is deliberate.

## Considered options

**Re-arming** — let a client `PATCH` a Finished Alert back to `active`. Rejected because the
operation has no single meaning. A re-armed `once` Alert is a `once` that happened twice. A re-armed
Expired Alert has to acquire a new Expiry from somewhere, and every rule for choosing one is a
surprise to somebody. Both readings have to be invented rather than derived, which is how a feature
ends up meaning something different to its author and its user.

**Cloning** — the copy carries the same Symbol, Condition, Threshold and Repeat policy, and starts
with its own Trigger history and its own Expiry. One meaning, no invention required. The Finished
Alert stays in the list as the record of what happened, which is the thing a re-armed Alert would
have destroyed.

## Consequences

The list screen owes a clone action **on the Finished Alert itself**. Forbidding the only obvious
route without paving the intended one would leave a user stuck in front of an Alert they cannot
restart — a worse outcome than either option above.
