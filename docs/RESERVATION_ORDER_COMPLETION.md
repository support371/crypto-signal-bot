# Reservation and order completion projections

This source-only phase follows reviewed recovery accounting. It does not enable
mainnet, call a provider, create reservations, or certify an external contract.

`persistReservationSettlement` reuses the existing exact decimal consumption and
remainder-release journal. Both ledger accounts must exist, be active, belong to
the reservation's exchange account and asset, and form an available/reserved
cash or inventory pair. `terminalFill` must be a boolean. The existing migration
016 trigger verifies the updated reservation before admitting its receipt;
failed version claims roll back journals, receipts and events together.

`persistCompletedOrder` finalizes an already terminal projected order. The caller
must run it in the existing exchange account coordinator's accounting queue,
after separately authorized settlement. It accepts account and order identifiers,
reads persisted evidence, and does not accept caller-supplied financial totals.

Completion requires:

- FILLED, CANCELLED, REJECTED or EXPIRED, with no pending cancellation;
- a matching latest REST, WebSocket or reconciliation terminal event, a stored
  response hash and an existing audit reference;
- no unresolved reservation: only CONSUMED or RELEASED is sufficient;
- a matching immutable accounting and reservation receipt for every fill;
- exact decimal base and quote totals matching the exchange order projection.

The transaction rechecks state, observation sequence, fill count and reservation
completion. Its SETTLED event is inserted only if the guarded order update changes
one row. Event insertion failure rolls back the order update. Replay verifies
financial evidence again and compares its hash to the stored completion event.
The event references the terminal observation's existing audit hash; this phase
does not manufacture a new immutable audit-chain entry.

The follow-up [reviewed runtime](REVIEWED_ORDER_COMPLETION_RUNTIME.md) connects
this primitive to an internal coordinator command with operation-specific current
authority. Public mutations remain blocked and no activation has been deployed.
The follow-up also supplies an independently recorded zero-fill cancellation
release; it creates no synthetic fill. Accounting approval is not reused as
reservation-release authority. Partial-fill cancellation still needs reviewed
remainder release if its last fill was already settled as nonterminal. Unknown
recovery orders cannot be marked settled from FIFO evidence alone.

Validation uses real SQLite with foreign keys and migrations 003–030, actual FIFO
posting, reservation journals/receipts and order events. It exercises consumption
including reserved fees, remainder release, replay, incorrect ledger ownership,
asset/type/status, missing terminal evidence, incomplete totals, reservation
version drift, order drift and transaction rollback. No real exchange request or
real-money action is used. Rollback reverts source without deleting evidence or
changing schemas.
