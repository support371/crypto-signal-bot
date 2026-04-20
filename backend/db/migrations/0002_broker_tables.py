"""Add broker tables for MT5 integration

Revision ID: 0002_broker_tables
Revises: 0001_initial
Create Date: 2026-04-20

Creates:
  - broker_orders
  - broker_positions
  - broker_fills
  - broker_health
  - broker_sessions
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0002_broker_tables"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "broker_orders",
        sa.Column("id",               sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column("venue",            sa.String(32),  nullable=False),
        sa.Column("client_order_id",  sa.String(128), nullable=False),
        sa.Column("broker_order_id",  sa.String(128), nullable=True),
        sa.Column("symbol",           sa.String(32),  nullable=False),
        sa.Column("broker_symbol",    sa.String(32),  nullable=False),
        sa.Column("side",             sa.String(8),   nullable=False),
        sa.Column("order_type",       sa.String(16),  nullable=False),
        sa.Column("volume",           sa.Float,       nullable=False),
        sa.Column("requested_price",  sa.Float,       nullable=True),
        sa.Column("fill_price",       sa.Float,       nullable=True),
        sa.Column("sl",               sa.Float,       nullable=True),
        sa.Column("tp",               sa.Float,       nullable=True),
        sa.Column("status",           sa.String(32),  nullable=False),
        sa.Column("comment",          sa.Text,        nullable=True),
        sa.Column("magic_number",     sa.Integer,     default=0),
        sa.Column("reason",           sa.Text,        nullable=True),
        sa.Column("created_at",       sa.BigInteger,  nullable=False),
        sa.Column("updated_at",       sa.BigInteger,  nullable=False),
    )
    op.create_index("ix_broker_orders_venue",   "broker_orders", ["venue"])
    op.create_index("ix_broker_orders_cid",     "broker_orders", ["client_order_id"])
    op.create_index("ix_broker_orders_symbol",  "broker_orders", ["symbol"])
    op.create_index("ix_broker_orders_status",  "broker_orders", ["status"])
    op.create_index("ix_broker_orders_created", "broker_orders", ["created_at"])

    op.create_table(
        "broker_positions",
        sa.Column("id",             sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column("venue",          sa.String(32),  nullable=False),
        sa.Column("position_id",    sa.String(128), nullable=False),
        sa.Column("symbol",         sa.String(32),  nullable=False),
        sa.Column("broker_symbol",  sa.String(32),  nullable=False),
        sa.Column("side",           sa.String(8),   nullable=False),
        sa.Column("volume",         sa.Float,       nullable=False),
        sa.Column("entry_price",    sa.Float,       nullable=False),
        sa.Column("current_price",  sa.Float,       nullable=True),
        sa.Column("sl",             sa.Float,       nullable=True),
        sa.Column("tp",             sa.Float,       nullable=True),
        sa.Column("unrealized_pnl", sa.Float,       default=0.0),
        sa.Column("swap",           sa.Float,       default=0.0),
        sa.Column("comment",        sa.Text,        nullable=True),
        sa.Column("magic_number",   sa.Integer,     default=0),
        sa.Column("is_open",        sa.Boolean,     default=True),
        sa.Column("opened_at",      sa.BigInteger,  nullable=False),
        sa.Column("updated_at",     sa.BigInteger,  nullable=False),
        sa.Column("closed_at",      sa.BigInteger,  nullable=True),
    )
    op.create_index("ix_broker_positions_venue",      "broker_positions", ["venue"])
    op.create_index("ix_broker_positions_pos_id",     "broker_positions", ["position_id"])
    op.create_index("ix_broker_positions_symbol",     "broker_positions", ["symbol"])
    op.create_index("ix_broker_positions_is_open",    "broker_positions", ["is_open"])
    op.create_index("ix_broker_positions_opened_at",  "broker_positions", ["opened_at"])

    op.create_table(
        "broker_fills",
        sa.Column("id",              sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column("venue",           sa.String(32),  nullable=False),
        sa.Column("fill_id",         sa.String(128), nullable=False),
        sa.Column("broker_order_id", sa.String(128), nullable=False),
        sa.Column("position_id",     sa.String(128), nullable=True),
        sa.Column("symbol",          sa.String(32),  nullable=False),
        sa.Column("broker_symbol",   sa.String(32),  nullable=False),
        sa.Column("side",            sa.String(8),   nullable=False),
        sa.Column("volume",          sa.Float,       nullable=False),
        sa.Column("price",           sa.Float,       nullable=False),
        sa.Column("fee",             sa.Float,       default=0.0),
        sa.Column("realized_pnl",    sa.Float,       default=0.0),
        sa.Column("timestamp",       sa.BigInteger,  nullable=False),
    )
    op.create_index("ix_broker_fills_venue",     "broker_fills", ["venue"])
    op.create_index("ix_broker_fills_order_id",  "broker_fills", ["broker_order_id"])
    op.create_index("ix_broker_fills_symbol",    "broker_fills", ["symbol"])
    op.create_index("ix_broker_fills_timestamp", "broker_fills", ["timestamp"])

    op.create_table(
        "broker_health",
        sa.Column("id",                  sa.Integer,    primary_key=True, autoincrement=True),
        sa.Column("venue",               sa.String(32), nullable=False),
        sa.Column("terminal_connected",  sa.Boolean,    default=False),
        sa.Column("broker_session_ok",   sa.Boolean,    default=False),
        sa.Column("symbols_loaded",      sa.Boolean,    default=False),
        sa.Column("order_path_ok",       sa.Boolean,    default=False),
        sa.Column("latency_ms",          sa.Float,      nullable=True),
        sa.Column("last_error",          sa.Text,       nullable=True),
        sa.Column("timestamp",           sa.BigInteger, nullable=False),
    )
    op.create_index("ix_broker_health_venue",     "broker_health", ["venue"])
    op.create_index("ix_broker_health_timestamp", "broker_health", ["timestamp"])

    op.create_table(
        "broker_sessions",
        sa.Column("id",                   sa.Integer,     primary_key=True, autoincrement=True),
        sa.Column("venue",                sa.String(32),  nullable=False),
        sa.Column("login_id",             sa.String(64),  nullable=False),
        sa.Column("server",               sa.String(128), nullable=False),
        sa.Column("connected",            sa.Boolean,     default=False),
        sa.Column("authorized",           sa.Boolean,     default=False),
        sa.Column("terminal_initialized", sa.Boolean,     default=False),
        sa.Column("last_error_code",      sa.Integer,     nullable=True),
        sa.Column("last_error_message",   sa.Text,        nullable=True),
        sa.Column("last_seen_at",         sa.BigInteger,  nullable=False),
    )
    op.create_index("ix_broker_sessions_venue",       "broker_sessions", ["venue"])
    op.create_index("ix_broker_sessions_last_seen",   "broker_sessions", ["last_seen_at"])


def downgrade() -> None:
    for table in [
        "broker_sessions", "broker_health", "broker_fills",
        "broker_positions", "broker_orders",
    ]:
        op.drop_table(table)
