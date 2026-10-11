"""A fitted daily-mean baseline with chronological, remaining-month backtests."""
import calendar
import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.db import transactions
from app.routes.transactions import Category, invalid

HISTORY_MONTHS = 6
MAX_CENTS = 9_007_199_254_740_991


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: Category
    as_of: date
    horizon_days: int = Field(ge=0, le=31, strict=True)


def month_shift(month, offset):
    index = month.year * 12 + month.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def rounded(value):
    # Exact integer cents with half-up rounding, without binary floating point.
    return (value.numerator * 2 + value.denominator) // (2 * value.denominator)


def fit_daily_mean(months):
    """Least-squares constant fitted over daily net-spend observations."""
    total = sum(item["total"] for item in months)
    days = sum(item["days"] for item in months)
    return max(Fraction(0), Fraction(total, days))


class ForecastService:
    def __init__(self, engine, owner_id):
        self.engine, self.owner_id = engine, owner_id

    def forecast(self, request):
        as_of = request.as_of
        if as_of.year < 2 or as_of.year > 9998:
            invalid("Forecast date is outside the supported range.")
        remaining = calendar.monthrange(as_of.year, as_of.month)[1] - as_of.day
        if request.horizon_days != remaining:
            invalid("horizon_days must equal the days after as_of through the end of that month.")
        result = {"category": request.category, "as_of": as_of.isoformat(), "horizon_days": remaining,
                  "forecast_remaining_cents": None, "predicted_period_total_cents": None,
                  "budget_cents": None, "model_version": None, "backtest_mae_cents": None,
                  "data_quality": "not_trained"}
        if os.getenv("FORECAST_ENABLED", "true").lower() in {"false", "0"}:
            return result
        if self.engine is None:
            raise HTTPException(503, {"error_code": "DATABASE_UNAVAILABLE", "message": "Database is not configured."})
        current_month = as_of.replace(day=1)
        try:
            start = month_shift(current_month, -HISTORY_MONTHS)
        except ValueError:
            invalid("Forecast date has insufficient preceding calendar months.")
        cutoff = datetime.combine(as_of + timedelta(days=1), datetime.min.time(), timezone.utc)
        with self.engine.connect() as connection:
            rows = connection.execute(select(transactions).where(
                transactions.c.owner_id == self.owner_id,
                transactions.c.occurred_at >= datetime.combine(start, datetime.min.time(), timezone.utc),
                transactions.c.occurred_at < cutoff,
            ).order_by(transactions.c.occurred_at, transactions.c.id)).mappings().all()
        rows = [dict(row) for row in rows]
        for row in rows:
            occurred = row["occurred_at"]
            row["occurred_at"] = (occurred.replace(tzinfo=timezone.utc) if occurred.tzinfo is None else occurred.astimezone(timezone.utc))
        monthly = []
        for offset in range(HISTORY_MONTHS):
            month = month_shift(start, offset)
            activity = [row for row in rows if row["occurred_at"].date().replace(day=1) == month]
            category_rows = [row for row in activity if row["category"] == request.category]
            monthly.append({"month": month, "days": calendar.monthrange(month.year, month.month)[1],
                            "activity": bool(activity), "rows": category_rows,
                            "total": sum(row["amount_cents"] for row in category_rows)})
        selected = [row for row in rows if row["category"] == request.category]
        if any(row["currency"] != "USD" for row in selected):
            invalid("Forecast and demo budget require USD transactions; currencies cannot be combined.")
        # Gaps in account activity are not silently interpreted as complete zero-spend months.
        history = [row for item in monthly for row in item["rows"]]
        if (not all(item["activity"] for item in monthly) or len(history) < 6 or
                sum(item["total"] > 0 for item in monthly) < 3):
            result["data_quality"] = "insufficient_history"
            return result
        budget = None
        if request.category == "Dining":
            try:
                raw_budget = os.getenv("DINING_BUDGET_CENTS", "5000")
                budget = int(raw_budget)
                if not raw_budget.isdecimal() or not 0 <= budget <= MAX_CENTS:
                    raise ValueError()
            except ValueError:
                raise HTTPException(503, {"error_code": "CONFIGURATION_ERROR", "message": "Dining budget configuration is invalid."}) from None
        # Three expanding-window folds. Each fit sees only earlier completed months.
        errors = []
        for index in range(3, HISTORY_MONTHS):
            target = monthly[index]
            fold_day = min(as_of.day, target["days"])
            horizon = target["days"] - fold_day
            prediction = rounded(fit_daily_mean(monthly[:index]) * horizon)
            actual = sum(row["amount_cents"] for row in target["rows"] if row["occurred_at"].day > fold_day)
            errors.append(abs(prediction - actual))
        rate = fit_daily_mean(monthly)
        prediction = rounded(rate * remaining)
        spent = sum(row["amount_cents"] for row in selected if row["occurred_at"].date() >= current_month)
        total = spent + prediction
        if abs(total) > MAX_CENTS or prediction > MAX_CENTS:
            invalid("Forecast exceeds the supported integer-cents range.")
        training = sorted([row["occurred_at"].isoformat(), row["amount_cents"], row["currency"]] for row in history)
        fingerprint = hashlib.sha256(json.dumps([self.owner_id, request.category, training], separators=(",", ":")).encode()).hexdigest()[:12]
        result.update(forecast_remaining_cents=prediction, predicted_period_total_cents=total,
                      budget_cents=budget, model_version=f"daily-mean-v1-{fingerprint}",
                      backtest_mae_cents=rounded(Fraction(sum(errors), len(errors))), data_quality="sufficient")
        return result
