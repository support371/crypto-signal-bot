"""Add durable execution idempotency ledger.

Revision ID: 0003_execution_requests
Revises: 0002_broker_tables
Create Date: 2026-06-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_execution_requests"
down_revision = "0002_broker_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "execution_requests",
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("operation_id", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("intent_id", sa.String(length=64), nullable=True),
        sa.Column("exchange_order_id", sa.String(length=128), nullable=True),
        sa.Column("response_json", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.BigInteger(), nullable=True),
        sa.Column("updated_at", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("idempotency_key"),
    )
    op.create_index(
        "ix_execution_requests_operation_id",
        "execution_requests",
        ["operation_id"],
        unique=True,
    )
    op.create_index(
        "ix_execution_requests_status",
        "execution_requests",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_execution_requests_intent_id",
        "execution_requests",
        ["intent_id"],
        unique=False,
    )
    op.create_index(
        "ix_execution_requests_created_at",
        "execution_requests",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_execution_requests_updated_at",
        "execution_requests",
        ["updated_at"],
        unique=False,
    )
    op.create_index(
        "ix_execution_requests_status_updated",
        "execution_requests",
        ["status", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    for index_name in (
        "ix_execution_requests_status_updated",
        "ix_execution_requests_updated_at",
        "ix_execution_requests_created_at",
        "ix_execution_requests_intent_id",
        "ix_execution_requests_status",
        "ix_execution_requests_operation_id",
    ):
        op.drop_index(index_name, table_name="execution_requests")
    op.drop_table("execution_requests")
