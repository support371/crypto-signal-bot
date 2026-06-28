"""Tests for the persistent execution idempotency ledger."""

from __future_ import annotations

from contextlib import asynccontextmanager

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.db.models import Base
from backend.db.models.execution_request import ExecutionRequestRecord  # noqa: F401
from backend.services import execution_idempotency as service


def test_request_fingerprint_is_stable_and_mode_scoped():
    payload = {"symbol": "BTCUSDT", "quantity": 0.01}
    first = service.request_fingerprint(payload, "live")
    second = service.request_fingerprint(
        {"quantity": 0.01, "symbol": "BTCUSDT"},
        "live",
    )
    paper = service.request_fingerprint(payload, "paper")

    assert first == second
    assert first != paper

@pytest.mark.parametrize(
    "value",
    ["", "tiny", "contains space", "bad/slash", "x" * 129],
)
def test_invalid_idempotency_keys_are_rejected(value):
    with pytest.raises(service.InvalidIdempotencyKey):
        service.validate_idempotency_key(value)


def test_existing_terminal_request_replays_response():
    result = service.classify_existing(
        request_hash="same",
        existing_hash="same",
        operation_id="op-1",
        status="COMPLETED",
        response_json='{"id":"intent-1","status":"FILLED"}',
        updated_at=100,
        now=110,
    )

    assert result.state == "REPLAY"

    assert result.response == {"id": "intent-1", "status": "FILLED"}


def test_terminal_partial_request_replays_response():
    result = service.classify_existing(
        request_hash="same",
        existing_hash="same",
        operation_id="op-1",
        status="COMPLETED_PARTIAL",
        response_json='{"id":"intent-1","status":"PARTIALLY_FILLED"}',
        updated_at=100,
        now=110,
    )

    assert result.state == "REPLAY"
    assert result.response["status"] == "PARTIALLY_FILLED"


def test_existing_key_with_different_payload_conflicts():
    result = service.classify_existing(
        request_hash="new",
        existing_hash="old",
        operation_id="op-1",
        status="COMPLETED",
        response_json=None,
        updated_at=100,
        now=110,
    )

    assert result.state == "CONFLICT"


def test_stale_submitting_request_requires_recovery():
    result = service.classify_existing(
        request_hash="same",
        existing_hash="same",
        operation_id="op-1",
        status="SUBMITTING",
        response_json=None,
        updated_at=100,
        now=500,
        stale_seconds=300,
    )

    assert result.state == "RECOVERY_REQUIRED"


def test_fresh_partial_fill_remains_in_progress():
    result = service.classify_existing(
        request_hash="same",
        existing_hash="same",
        operation_id="op-1",
        status="PARTIALLY_FILLED",
        response_json='{"status":"PARTIALLY_FILLED"}',
        updated_at=100,
        now=110,
    )

    assert result.state == "IN_PROGRESS"


@pytest.mark.parametrize(
    ("response_status", "ledger_status"),
    [
        ("FILLED", "COMPLETED"),
        ("PARTIALLY_FILLED", "PARTIALLY_FILLED"),
        ("SUBMITTED", "SUBMITTED"),
        ("CANCELLED", "CANCELLED"),
        ("RISK_REJECTED", "REJECTED"),
        ("FAILED", "FAILED"),
        ("UNKNOWN", "RECOVERY_REQUIRED"),
    ],
)
def test_response_status_maps_fail_closed(response_status, ledger_status):
    assert (
        service.ledger_status_for_response({"status": response_status})
        == ledger_status
     )


def test_terminal_partial_reconciliation_is_replayable():
    status = service.ledger_status_for_reconciliation(
        {"status": "PARTIALLY_FILLED", "terminal": True}
    )
    assert status == "COMPLETED_PARTIAL"


def test_unknown_reconciliation_requires_recovery():
    status = service.ledger_status_for_reconciliation(
        {"status": "MYSTERY", "terminal": False}
    )
    assert status == "RECOVERY_REQUIRED"


@pytest.mark.asyncio
async def test_claim_complete_and_replay_survive_new_sessions(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    @asynccontextmanager
    async def test_session():
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(service, "get_session", test_session)

    payload = {"symbol": "BTCUSDT", "quantity": 0.01}
    claimed = await service.claim_execution(
        idempotency_key="order:test:0001",
        payload=payload,
        mode="live",
    )
    assert claimed.state == "CLAIMED"
    assert await service.mark_submitting(
        "order:test:0001",
        claimed.operation_id,
    )
    assert await service.complete_execution(
        idempotency_key="order:test:0001",
        operation_id=claimed.operation_id,
        intent_id="intent-1",
        response={"id": "intent-1", "status": "FILLED", "notes": None},
        exchange_order_id="exchange-1",
    )

    replay = await service.claim_execution(
        idempotency_key="order:test:0001",
        payload=payload,
        mode="live",
    )
    assert replay.state == "REPLAY"
    assert replay.response["id"] == "intent-1"

    status = await service.get_execution_status("order:test:0001")
    assert status["status"] == "COMPLETED"
    assert status["intent_id"] == "intent-1"
    assert status["exchange_order_id"] == "exchange-1"

    await engine.dispose()


@pytest.mark.asyncio
async def test_partial_fill_stays_active_until_reconciliation(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    @asynccontextmanager
    async def test_session():
        async with factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise

    monkeypatch.setattr(service, "get_session", test_session)

    payload = {"symbol": "BTCUSDT", "quantity": 2}
    claimed = await service.claim_execution(
        idempotency_key="order:test:partial",
        payload=payload,
        mode="live",
    )
    assert await service.mark_submitting(
        "order:test:partial",
        claimed.operation_id,
    )
    assert await service.complete_execution(
        idempotency_key="order:test:partial",
        operation_id=claimed.operation_id,
        intent_id="intent-partial",
        response={"id": "intent-partial", "status": "PARTIALLY_FILLED"},
        exchange_order_id="exchange-partial",
    )

    status = await service.get_execution_status("order:test:partial")
    assert status["status"] == "PARTIALLY_FILLED"

    duplicate = await service.claim_execution(
        idempotency_key="order:test:partial",
        payload=payload,
        mode="live",
    )
    assert duplicate.state == "IN_PROGRESS"

    assert await service.apply_reconciliation(
        idempotency_key="order:test:partial",
        operation_id=claimed.operation_id,
        decision={
            "exchange_order_id": "exchange-partial",
            "status": "PARTIALLY_FILLED",
            "terminal": True,
            "filled_quantity": 0.5,
            "requested_quantity": 2,
        },
    )

    terminal = await service.claim_execution(
        idempotency_key="order:test:partial",
        payload=payload,
        mode="live",
    )
    assert terminal.state == "REPLAY"

    assert terminal.status == "COMPLETED_PARTIAL"

    await engine.dispose()
