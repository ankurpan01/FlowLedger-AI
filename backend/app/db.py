"""Explicit, additive schema setup. Application startup never creates tables."""
import sys

from sqlalchemy import (
    BigInteger, CheckConstraint, Column, DateTime, Index, JSON, MetaData, String,
    Table, UniqueConstraint, func,
)

CATEGORIES = ("Groceries", "Dining", "Transport", "Housing", "Shopping", "Entertainment", "Bills", "Other")
metadata = MetaData()
transactions = Table(
    "flowledger_transactions", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(128), nullable=False),
    Column("occurred_at", DateTime(timezone=True), nullable=False),
    Column("merchant", String(200), nullable=False),
    Column("amount_cents", BigInteger, nullable=False),
    Column("currency", String(3), nullable=False),
    Column("category", String(20), nullable=False),
    Column("import_key", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    UniqueConstraint("owner_id", "import_key", name="uq_flowledger_import"),
    CheckConstraint("category IN ('Groceries','Dining','Transport','Housing','Shopping','Entertainment','Bills','Other')", name="ck_flowledger_category"),
    Index("ix_flowledger_owner_date", "owner_id", "occurred_at"),
)

proposals = Table(
    "flowledger_proposals", metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("owner_id", String(128), nullable=False),
    Column("payload", JSON, nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("status", String(12), nullable=False, server_default="pending"),
    Column("idempotency_key", String(128)),
    Column("result", JSON),
    UniqueConstraint("owner_id", "idempotency_key", name="uq_flowledger_confirmation"),
    CheckConstraint("status IN ('pending','applied')", name="ck_flowledger_proposal_status"),
)
audit = Table(
    "flowledger_confirmation_audit", metadata,
    Column("id", String(36), primary_key=True),
    Column("owner_id", String(128), nullable=False),
    Column("proposal_hash", String(64), nullable=False, unique=True),
    Column("changes", JSON, nullable=False),
    Column("confirmed_at", DateTime(timezone=True), nullable=False),
)


def main():
    arguments = sys.argv[1:]
    if arguments in (['schema-enhance'], ['migrate-enhance']):
        from app import workspace, planning, documents
        from .main import app
        tables = [table for table in metadata.sorted_tables if table not in [transactions, proposals, audit]]
        if arguments == ['schema-enhance']:
            from sqlalchemy.dialects import postgresql
            from sqlalchemy.schema import CreateIndex, CreateTable
            for table in tables:
                print(str(CreateTable(table, if_not_exists=True).compile(dialect=postgresql.dialect())) + ';')
                for index in table.indexes:
                    print(str(CreateIndex(index, if_not_exists=True).compile(dialect=postgresql.dialect())) + ';')
        else:
            if app.state.engine is None:
                raise SystemExit('Database is not configured.')
            metadata.create_all(app.state.engine, tables=tables)
            print('Additive enhancement schema ready.')
        return
    tables = [proposals, audit] if arguments in (["schema-agent"], ["migrate-agent"]) else [transactions]
    if arguments in (["schema"], ["schema-agent"]):
        from sqlalchemy.dialects import postgresql
        from sqlalchemy.schema import CreateIndex, CreateTable
        dialect = postgresql.dialect()
        for table in tables:
            print(str(CreateTable(table, if_not_exists=True).compile(dialect=dialect)) + ";")
            for index in sorted(table.indexes, key=lambda item: item.name):
                print(str(CreateIndex(index, if_not_exists=True).compile(dialect=dialect)) + ";")
    elif arguments in (["migrate"], ["migrate-agent"]):
        from .main import app
        engine = app.state.engine
        if engine is None:
            raise SystemExit("Database is not configured; no schema changes applied.")
        try:
            metadata.create_all(engine, tables=tables)
            print("Requested FlowLedger schema ready.")
        except Exception:
            raise SystemExit("Schema setup failed; check database permissions privately.") from None
        finally:
            engine.dispose()
    else:
        raise SystemExit("Usage: python -m app.db schema | migrate | schema-agent | migrate-agent")


if __name__ == "__main__":
    main()
