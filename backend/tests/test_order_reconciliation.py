"""Tests for deterministic exchange-order reconciliation."""

from backend.services.order_reconciliation import reconcile_order_observation


def test_full_fill_is_terminal():
    decision = reconcile_order_observation(
       {"id": "ex-1", "status": "closed", "amount": 2, "filled": 2, "average": 100}
    )
    assert decision.status == "FILLED"
    assert decision.action == "FINALIZE"
    assert decision.terminal is True
    assert decision.remaining_quantity == 0


def test_open_partial_fill_waits_without_resubmission():
    decision = reconcile_order_observation(
       {"id": "ex-2", "status": "open", "amount": 2, "filled": 0.5}
    )
    assert decision.status == "PARTIALLY_FILLED"
    assert decision.action == "WAIT"
    assert decision.terminal is False
    assert decision.filled_quantity == 0.5
    assert decision.remaining_quantity == 1.5


def test_cancelled_partial_fill_finalizes_partial():
    decision = reconcile_order_observation(
        {"id": "ex-3", "status": "cancelled", "amount": 2, "filled": 0.5}
    )
    assert decision.status == "PARTIALLY_FILLED"
    assert decision.action == "FINALIZE_PARTIAL"
    assert decision.terminal is True


def test_cancelled_unfilled_order_is_terminal():
    decision = reconcile_order_observation(
       {"id": "ex-4", "status": "canceled", "amount": 2, "filled": 0}
    )
    assert decision.status == "CANCELLED"
    assert decision.terminal is True


def test_stale_open_order_requires_recovery_not_retry():
    decision = reconcile_order_observation(
       {"id": "ex-5", "status": "open", "amount": 2, "filled": 0},
        observed_at=100,
        now=500,
        stale_after_seconds=300,
    )
    assert decision.status == "RECOVERY_REQUIRED"
    assert decision.action == "HMALT_FOR_REVIEW"
    assert decision.reason == "stale_exchange_order"


def test_unknown_status_requires_recovery():
    decision = reconcile_order_observation(
        {"id": "ex-6", "status": "mystery", "amount": 2, "filled": 0}
    )
    assert decision.status == "RECOVERY_REQUIRED"
    assert decision.requires_review is True


def test_overfill_requires_recovery():
    decision = reconcile_order_observation(
        {"id": "ex-7", "status": "closed", "amount": 2, "filled": 3}
    )
    assert decision.status == "RECOVERY_REQUIRED"
    assert decision.reason == "filled_quantity_exceeds_requested"


def test_missing_exchange_order_id_requires_recovery():
    decision = reconcile_order_observation(
       {"status": "open", "amount": 2, "filled": 0}
    )
    assert decision.status == "RECOVERY_REQUIRED"
    assert decision.reason == "exchange_order_id_missing"


def test_closed_without_fill_requires_recovery():
    decision = reconcile_order_observation(
        {"id": "ex-8", "status": "closed", "amount": 2, "filled": 0}
    )
    assert decision.status == "RECOVERY_REQUIRED"
    assert decision.reason == "terminal_status_without_fill"
