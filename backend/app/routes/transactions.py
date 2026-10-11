import csv
import hashlib
import io
import json
import re
from datetime import date, datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.db import CATEGORIES, transactions as table

Category = Literal["Groceries", "Dining", "Transport", "Housing", "Shopping", "Entertainment", "Bills", "Other"]
CSV_COLUMNS = ["occurred_at", "merchant", "amount_cents", "currency", "category"]
MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 10_000


class CategoryEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category


def invalid(message, details=None):
    raise HTTPException(400, {
        "error_code": "VALIDATION_ERROR", "message": message, "details": details or [],
    })


def serialize(row):
    value = row["occurred_at"]
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return {
        "id": row["id"], "occurred_at": value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "merchant": row["merchant"], "amount_cents": row["amount_cents"],
        "currency": row["currency"], "category": row["category"],
    }


def parse_row(row):
    if None in row or any(value is None for value in row.values()):
        raise ValueError("Expected exactly five columns")
    row = {key: value.strip() for key, value in row.items()}
    raw_date = row["occurred_at"]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
        occurred = datetime.combine(date.fromisoformat(raw_date), datetime.min.time(), timezone.utc)
    else:
        occurred = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        if occurred.tzinfo is None:
            raise ValueError("Timestamp must include a timezone")
        occurred = occurred.astimezone(timezone.utc)
    merchant = row["merchant"]
    if not merchant or len(merchant) > 200 or any(ord(char) < 32 for char in merchant):
        raise ValueError("Merchant must contain 1–200 printable characters")
    if not re.fullmatch(r"-?\d+", row["amount_cents"]):
        raise ValueError("amount_cents must be an integer")
    cents = int(row["amount_cents"])
    if abs(cents) > 9_007_199_254_740_991:
        raise ValueError("amount_cents exceeds supported integer range")
    if not re.fullmatch(r"[A-Z]{3}", row["currency"]):
        raise ValueError("Currency must be a three-letter uppercase code")
    if row["category"] not in CATEGORIES:
        raise ValueError("Invalid category")
    # Category is deliberately excluded: re-import cannot undo a later edit.
    identity = [occurred.isoformat(), merchant, cents, row["currency"]]
    return {
        "id": str(uuid4()), "occurred_at": occurred, "merchant": merchant,
        "amount_cents": cents, "currency": row["currency"], "category": row["category"],
        "import_key": hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest(),
    }


def make_router(engine, owner_id):
    router = APIRouter()

    def require_database():
        if engine is None:
            raise HTTPException(503, {"error_code": "DATABASE_UNAVAILABLE", "message": "Database is not configured."})

    @router.post("/transactions/import")
    async def import_csv(file: UploadFile = File(...)):
        require_database()
        try:
            raw = await file.read(MAX_BYTES + 1)
        finally:
            await file.close()
        if len(raw) > MAX_BYTES:
            invalid("CSV exceeds the 2 MiB limit.")
        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), strict=True)
            if reader.fieldnames != CSV_COLUMNS:
                invalid("CSV header must be occurred_at,merchant,amount_cents,currency,category.")
            parsed, errors = [], []
            for number, row in enumerate(reader, 2):
                if number > MAX_ROWS + 1:
                    invalid("CSV exceeds the 10,000-row limit.")
                try:
                    parsed.append(parse_row(row))
                except (ValueError, OverflowError):
                    # Never include raw CSV text or a parser exception in errors.
                    errors.append({"row": number, "reason": "Invalid date, merchant, integer cents, currency, or category"})
        except (UnicodeError, csv.Error):
            invalid("CSV must be valid UTF-8 with well-formed rows.")
        inserted, skipped = 0, len(errors)
        insert = pg_insert if engine.dialect.name == "postgresql" else sqlite_insert
        with engine.begin() as connection:
            for row in parsed:
                result = connection.execute(
                    insert(table).values(owner_id=owner_id, **row)
                    .on_conflict_do_nothing(index_elements=["owner_id", "import_key"])
                    .returning(table.c.id)
                )
                # psycopg may report rowcount=-1; RETURNING identifies an insert.
                if result.scalar_one_or_none() is not None:
                    inserted += 1
                else:
                    skipped += 1
        return {"imported_count": inserted, "skipped_count": skipped, "errors": errors}

    @router.get("/transactions")
    def list_transactions(merchant: str | None = None, category: Category | None = None):
        require_database()
        query = select(table).where(table.c.owner_id == owner_id)
        if merchant:
            query = query.where(func.lower(table.c.merchant).contains(merchant.lower(), autoescape=True))
        if category:
            query = query.where(table.c.category == category)
        with engine.connect() as connection:
            rows = connection.execute(query.order_by(table.c.occurred_at.desc(), table.c.id)).mappings()
            return {"transactions": [serialize(row) for row in rows]}

    @router.patch("/transactions/{transaction_id}")
    def edit_category(transaction_id: str, body: CategoryEdit):
        require_database()
        scope = (table.c.id == transaction_id) & (table.c.owner_id == owner_id)
        with engine.begin() as connection:
            result = connection.execute(update(table).where(scope).values(category=body.category, updated_at=datetime.now(timezone.utc)))
            if not result.rowcount:
                raise HTTPException(404, {"error_code": "TRANSACTION_NOT_FOUND", "message": "The requested transaction was not found."})
            row = connection.execute(select(table).where(scope)).mappings().one()
            return {"transaction": serialize(row)}

    @router.get("/dashboard/summary")
    def summary(month: str):
        require_database()
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            invalid("month must be YYYY-MM.")
        try:
            year, month_number = map(int, month.split("-"))
            start = datetime(year, month_number, 1, tzinfo=timezone.utc)
            end = datetime(year + (month_number == 12), 1 if month_number == 12 else month_number + 1, 1, tzinfo=timezone.utc)
        except ValueError:
            invalid("month must be a valid calendar month.")
        query = select(table.c.currency, table.c.category, func.sum(table.c.amount_cents).label("cents")).where(
            table.c.owner_id == owner_id, table.c.occurred_at >= start, table.c.occurred_at < end,
        ).group_by(table.c.currency, table.c.category)
        with engine.connect() as connection:
            rows = connection.execute(query).mappings().all()
        currencies = {row["currency"] for row in rows}
        if len(currencies) > 1:
            invalid("Monthly summary cannot combine different currencies.")
        amounts = {row["category"]: int(row["cents"]) for row in rows}
        return {
            "month": month, "currency": next(iter(currencies), "USD"),
            "total_spent_cents": sum(amounts.values()),
            "by_category": [{"category": category, "amount_cents": amounts[category]} for category in CATEGORIES if category in amounts],
        }

    return router
