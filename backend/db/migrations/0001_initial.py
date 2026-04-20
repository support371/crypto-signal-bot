"""Initial schema — all authoritative tables

Revision ID: 0001_initial
Revises: 
Create Date: 2026-04-19

Creates:
  - orders
  - fills
  - positions
  - balances
  - guardian_events
  - risk_events
  - audit_log
  - reconciliation_reports
  - service_heartbeats
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "orders",
        sa.Column("id",               sa.String(64),  primary_key=True),
        sa.Column("symbol",           sa.String(20),  nullable=False),
        sa.Column("side",             sa.String(8),   nullable=False),
        sa.Column("order_type",       sa.String(16),  nullable=False),
        sa.Column("quantity",         sa.Float,       nullable=False),
        sa.Column("price",            sa.Float,       nullable=True),
        sa.Column("fill_price",       sa.Float,       nullable=True),
        sa.Column("filled_qty",       sa.Float,       default=0.0),
        sa.Column("status",           sa.String(32),  nullable=False),
        sa.Column("mode",             sa.String(8),   nullable=False),
        sa.Column("venue",            sa.String(32),  nullable=False),
        sa.Column("exchange_order_id",sa.String(128), nullable=True),
        sa.Column("reject_reason",    sa.Text,        nullable=True),
        sa.Column("created_at",       sa.BigInteger,  nullable=False),
        sa.Column("updated_at",       sa.BigInteger,  nullable=False),
    )
    op.create_index("ix_orders_symbol",          "orders", ["symbol"])
    op.create_index("ix_orders_status",          "orders", ["status"])
    op.create_index("ix_orders_symbol_created",  "orders", ["symbol", "created_at"])
    op.create_index("ix_orders_status_created",  "orders", ["status", "created_at"])

    op.create_table(
        "fills",
        sa.Column("id",         sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("order_id",   sa.String(64), nullable=False),
        sa.Column("symbol",     sa.String(20), nullable=False),
        sa.Column("side",       sa.String(8),  nullable=False),
        sa.Column("quantity",   sa.Float,      nullable=False),
        sa.Column("fill_price", sa.Float,      nullable=False),
        sa.Column("mode",       sa.String(8),  nullable=False),
        sa.Column("venue",      sa.String(32), nullable=False),
        sa.Column("filled_at",  sa.BigInteger, nullable=False),
    )
    op.create_index("ix_fills_order_id",          "fills", ["order_id"])
    op.create_index("ix_fills_symbol_filled_at",  "fills", ["symbol", "filled_at"])

    op.create_table(
        "positions",
        sa.Column("id",         sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("symbol",     sa.String(20), nullable=False),
        sa.Column("side",       sa.String(8),  nullable=False),
        sa.Column("quantity",   sa.Float,      nullable=False),
        sa.Column("cost_basis", sa.Float,      nullable=False),
        sa.Column("mode",       sa.String(8),  nullable=False),
        sa.Column("order_id",   sa.String(64), nullable=False),
        sa.Column("opened_at",  sa.BigInteger, nullable=False),
        sa.Column("closed_at",  sa.BigInteger, nullable=True),
        sa.Column("is_open",    sa.Boolean,    default=True),
    )
    op.create_index("ix_positions_symbol",  "positions", ["symbol"])
    op.create_index("ix_positions_is_open", "positions", ["is_open"])

    op.create_table(
        "balances",
        sa.Column("id",          sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("asset",       sa.String(20), nullable=False),
        sa.Column("amount",      sa.Float,      nullable=False),
        sa.Column("mode",        sa.String(8),  nullable=False),
        sa.Column("source",      sa.String(32), nullable=False),
        sa.Column("recorded_at", sa.BigInteger, nullable=False),
    )
    op.create_index("ix_balances_asset",       "balances", ["asset"])
    op.create_index("ix_balances_recorded_at", "balances", ["recorded_at"])

    op.create_table(
        "guardian_events",
        sa.Column("id",               sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("event_type",       sa.String(64), nullable=False),
        sa.Column("source",           sa.String(32), nullable=False),
        sa.Column("reason",           sa.Text,       nullable=True),
        sa.Column("kill_switch_was",  sa.Boolean,    nullable=True),
        sa.Column("kill_switch_now",  sa.Boolean,    nullable=True),
        sa.Column("drawdown_pct",     sa.Float,      nullable=True),
        sa.Column("api_error_count",  sa.Integer,    nullable=True),
        sa.Column("created_at",       sa.BigInteger, nullable=False),
    )
    op.create_index("ix_guardian_event_type", "guardian_events", ["event_type"])
    op.create_index("ix_guardian_created_at", "guardian_events", ["created_at"])

    op.create_table(
        "risk_events",
        sa.Column("id",         sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("intent_id",  sa.String(64), nullable=True),
        sa.Column("symbol",     sa.String(20), nullable=False),
        sa.Column("side",       sa.String(8),  nullable=False),
        sa.Column("risk_score", sa.Float,      nullable=True),
        sa.Column("decision",   sa.String(32), nullable=False),
        sa.Column("approved",   sa.Boolean,    nullable=False),
        sa.Column("reason",     sa.Text,       nullable=True),
        sa.Column("timestamp",  sa.BigInteger, nullable=False),
    )
    op.create_index("ix_risk_events_symbol",    "risk_events", ["symbol"])
    op.create_index("ix_risk_events_timestamp", "risk_events", ["timestamp"])

    op.create_table(
        "audit_log",
        sa.Column("id",         sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("actor",      sa.String(32), nullable=False),
        sa.Column("symbol",     sa.String(20), nullable=True),
        sa.Column("side",       sa.String(8),  nullable=True),
        sa.Column("quantity",   sa.Float,      nullable=True),
        sa.Column("price",      sa.Float,      nullable=True),
        sa.Column("reason",     sa.Text,       nullable=True),
        sa.Column("order_id",   sa.String(64), nullable=True),
        sa.Column("mode",       sa.String(8),  nullable=True),
        sa.Column("extra_json", sa.Text,       nullable=True),
        sa.Column("timestamp",  sa.BigInteger, nullable=False),
    )
    op.create_index("ix_audit_event_type", "audit_log", ["event_type"])
    op.create_index("ix_audit_timestamp",  "audit_log", ["timestamp"])
    op.create_index("ix_audit_event_ts",   "audit_log", ["event_type", "timestamp"])

    op.create_table(
        "reconciliation_reports",
        sa.Column("id",                    sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("mode",                  sa.String(8), nullable=False),
        sa.Column("usdt_balance",          sa.Float,   nullable=False),
        sa.Column("total_realized_pnl",    sa.Float,   nullable=False),
        sa.Column("total_unrealized_pnl",  sa.Float,   nullable=True),
        sa.Column("open_lots_count",       sa.Integer, default=0),
        sa.Column("trade_count",           sa.Integer, default=0),
        sa.Column("discrepancy_detected",  sa.Boolean, default=False),
        sa.Column("discrepancy_detail",    sa.Text,    nullable=True),
        sa.Column("created_at",            sa.BigInteger, nullable=False),
    )
    op.create_index("ix_recon_created_at", "reconciliation_reports", ["created_at"])

    op.create_table(
        "service_heartbeats",
        sa.Column("service_name", sa.String(64),  primary_key=True),
        sa.Column("last_beat_at", sa.BigInteger,  nullable=False),
        sa.Column("status",       sa.String(32),  default="alive"),
        sa.Column("detail",       sa.Text,        nullable=True),
        sa.Column("updated_at",   sa.BigInteger,  nullable=False),
    )


def downgrade() -> None:
    for table in [
        "service_heartbeats", "reconciliation_reports", "audit_log",
        "risk_events", "guardian_events", "balances", "positions",
        "fills", "orders",
    ]:
        op.drop_table(table)
