from backend.db.models import (
    AuditLogRecord,
    Base,
    BalanceRecord,
    FillRecord,
    GuardianEventRecord,
    OrderRecord,
    PositionRecord,
    ReconciliationReport,
    RiskEventRecord,
    ServiceHeartbeat,
)
from backend.db.models.broker_tables import BrokerOrderRecord


def test_core_models_export_from_backend_db_models_package():
    expected_tables = {
        "orders",
        "fills",
        "positions",
        "balances",
        "guardian_events",
        "risk_events",
        "audit_log",
        "reconciliation_reports",
        "service_heartbeats",
    }
    exported_models = {
        OrderRecord,
        FillRecord,
        PositionRecord,
        BalanceRecord,
        GuardianEventRecord,
        RiskEventRecord,
        AuditLogRecord,
        ReconciliationReport,
        ServiceHeartbeat,
    }

    assert {model.__tablename__ for model in exported_models} == expected_tables


def test_broker_tables_share_authoritative_metadata_registry():
    assert BrokerOrderRecord.metadata is Base.metadata
    assert "orders" in Base.metadata.tables
    assert "broker_orders" in Base.metadata.tables
