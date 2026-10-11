"""Grounded analytics and preview-confirm planning operations."""
import calendar
import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import BigInteger, Column, DateTime, JSON, String, Table, UniqueConstraint, select
from app.db import metadata, transactions, proposals, audit
from app.workspace import private_owner
from app.routes.transactions import Category, serialize

budgets = Table('flowledger_budgets', metadata,
    Column('id', String(36), primary_key=True), Column('owner_id', String(128), nullable=False),
    Column('category', String(20), nullable=False), Column('amount_cents', BigInteger, nullable=False),
    Column('updated_at', DateTime(timezone=True), nullable=False), UniqueConstraint('owner_id', 'category', name='uq_flowledger_budget'))
goals = Table('flowledger_goals', metadata,
    Column('id', String(36), primary_key=True), Column('owner_id', String(128), nullable=False, index=True),
    Column('name', String(100), nullable=False), Column('target_cents', BigInteger, nullable=False),
    Column('progress_cents', BigInteger, nullable=False), Column('deadline', String(10)),
    Column('kind', String(20), nullable=False), Column('updated_at', DateTime(timezone=True), nullable=False))
models = Table('flowledger_models', metadata,
    Column('id', String(80), primary_key=True), Column('owner_id', String(128), nullable=False, index=True),
    Column('category', String(20), nullable=False), Column('artifact', JSON, nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False))

class BudgetInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    category: Category
    amount_cents: int = Field(ge=0, le=100_000_000, strict=True)

class GoalInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str | None = None
    name: str = Field(min_length=1, max_length=100)
    target_cents: int = Field(gt=0, le=100_000_000, strict=True)
    progress_cents: int = Field(default=0, ge=0, le=100_000_000, strict=True)
    deadline: date | None = None
    kind: str = Field(default='savings', pattern='^(savings|spending_reduction)$')

class StatsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    month: str = Field(pattern=r'^\d{4}-\d{2}$')
    months: int = Field(default=3, ge=1, le=24)
    category: Category | None = None

class EmptyInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

class ProposalToken(BaseModel):
    proposal_token: str = Field(min_length=20, max_length=128)

class TransactionRecordInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['add', 'delete']
    record: dict | None = None
    transaction_ids: list[str] = Field(default_factory=list, max_length=200)

def json_row(row):
    if row is None:
        return None
    return {key: value.isoformat() if isinstance(value, (datetime, date)) else value for key, value in dict(row).items() if key != 'owner_id'}

class PlanningService:
    def __init__(self, engine, owner_id):
        self.engine, self.owner_id = engine, owner_id

    def read(self):
        with self.engine.connect() as c:
            bs = c.execute(select(budgets).where(budgets.c.owner_id == self.owner_id)).mappings().all()
            gs = c.execute(select(goals).where(goals.c.owner_id == self.owner_id)).mappings().all()
        values = [json_row(row) for row in bs]
        if not any(row['category'] == 'Dining' for row in values):
            values.append({'id': None, 'category': 'Dining', 'amount_cents': 5000, 'updated_at': None, 'source': 'demo default'})
        return {'budgets': values, 'goals': [json_row(row) for row in gs]}

    def prepare_record(self, args):
        from app.agent import digest, utc
        from app.routes.transactions import parse_row, CSV_COLUMNS, invalid
        if not self.owner_id.startswith('workspace-'):
            raise HTTPException(401, {'message':'A private workspace is required.'})
        token, expires = secrets.token_urlsafe(32), datetime.now(timezone.utc)+timedelta(minutes=10)
        with self.engine.begin() as c:
            snapshots=[]
            if args.action=='add':
                if not args.record or args.transaction_ids:
                    invalid('Provide one complete transaction record to add.')
                try:
                    row=parse_row({k:str(args.record[k]) for k in CSV_COLUMNS})
                except (KeyError, ValueError, OverflowError):
                    invalid('Invalid transaction fields.')
                record={k:row[k].isoformat() if k=='occurred_at' else row[k] for k in CSV_COLUMNS}
                changes=[{'id':row['id'],'before':None,'after':record}]
            else:
                ids=args.transaction_ids
                if not ids or len(set(ids))!=len(ids) or args.record:
                    invalid('Select unique transaction IDs to delete.')
                rows=c.execute(select(transactions).where(transactions.c.owner_id==self.owner_id,transactions.c.id.in_(ids)).with_for_update()).mappings().all()
                if len(rows)!=len(ids):
                    raise HTTPException(404, {'message':'Selected transactions are not available for this workspace.'})
                snapshots=[{'id':r['id'],'revision':utc(r['updated_at']).isoformat()} for r in rows]
                changes=[{'id':r['id'],'before':serialize(r),'after':{'action':'delete'}} for r in rows]
            c.execute(proposals.insert().values(token_hash=digest(token),owner_id=self.owner_id,status='pending',expires_at=expires,
                payload={'kind':'transaction_record','action':args.action,'snapshots':snapshots,'changes':changes}))
        return {'type':'proposal','kind':'transaction_record','proposal_token':token,'selected_ids':[r['id'] for r in changes],'changes':changes,'expires_at':expires.isoformat()}

    def stats(self, args):
        from app.forecast import month_shift
        try:
            end_month = date.fromisoformat(args.month + '-01')
            start = month_shift(end_month, 1 - args.months)
            end = month_shift(end_month, 1)
        except ValueError:
            raise HTTPException(400, {'message': 'Choose a valid calendar month.'}) from None
        with self.engine.connect() as c:
            rows = c.execute(select(transactions).where(transactions.c.owner_id == self.owner_id,
                transactions.c.occurred_at >= datetime.combine(start, datetime.min.time(), timezone.utc),
                transactions.c.occurred_at < datetime.combine(end, datetime.min.time(), timezone.utc))).mappings().all()
        if args.category:
            rows = [r for r in rows if r['category'] == args.category]
        if any(r['currency'] != 'USD' for r in rows):
            raise HTTPException(400, {'message': 'Analytics currently supports USD only; currencies cannot be combined.'})
        totals, cats, daily, recurring = defaultdict(int), defaultdict(int), defaultdict(int), defaultdict(list)
        for r in rows:
            day = r['occurred_at'].date().isoformat()
            totals[day[:7]] += r['amount_cents']
            daily[day] += r['amount_cents']
            if day[:7] == args.month:
                cats[r['category']] += r['amount_cents']
            recurring[r['merchant']].append(r)
        monthly = [{'month': month_shift(start, i).strftime('%Y-%m'), 'amount_cents': totals[month_shift(start, i).strftime('%Y-%m')]} for i in range(args.months)]
        current = monthly[-1]['amount_cents']
        previous = monthly[-2]['amount_cents'] if len(monthly) > 1 else None
        planning = self.read()
        alerts = []
        for b in planning['budgets']:
            spent = cats[b['category']]
            if spent > b['amount_cents']:
                alerts.append({'category': b['category'], 'over_cents': spent - b['amount_cents'], 'type': 'observed_budget_overrun'})
        rec = []
        for merchant, items in recurring.items():
            periods = {r['occurred_at'].strftime('%Y-%m') for r in items}
            amounts = [r['amount_cents'] for r in items]
            if len(periods) >= 3 and min(amounts) > 0 and max(amounts) <= min(amounts) * 1.15:
                rec.append({'merchant': merchant, 'average_cents': round(sum(amounts) / len(amounts)), 'months': len(periods), 'source': 'recurrence heuristic, not verified subscription'})
        return {'month': args.month, 'currency': 'USD', 'total_spent_cents': current,
            'previous_period_cents': previous, 'change_cents': current - previous if previous is not None else None,
            'by_category': [{'category': k, 'amount_cents': v} for k, v in sorted(cats.items())],
            'monthly': monthly, 'daily': [{'date': k, 'amount_cents': v} for k, v in sorted(daily.items())],
            'largest_expenses': [serialize(r) for r in sorted((r for r in rows if r['occurred_at'].strftime('%Y-%m') == args.month), key=lambda r: r['amount_cents'], reverse=True)[:5]],
            'recurring': rec, 'alerts': alerts, **planning,
            'recommendations': [{'source': 'budget heuristic', 'text': f"{a['category']} is ${a['over_cents']/100:.2f} above its recorded budget; review its largest purchases."} for a in alerts]}

    def prepare(self, kind, args):
        if not self.owner_id.startswith('workspace-'):
            raise HTTPException(401, {'message': 'Planning requires a private workspace.'})
        table = budgets if kind == 'budget' else goals
        with self.engine.begin() as c:
            scope = [table.c.owner_id == self.owner_id]
            if kind == 'budget':
                scope.append(budgets.c.category == args.category)
            elif args.id:
                scope.append(goals.c.id == args.id)
            else:
                scope.append(goals.c.id == '')
            before = c.execute(select(table).where(*scope).with_for_update()).mappings().first()
            if kind == 'goal' and args.id and not before:
                raise HTTPException(404, {'message': 'Goal not found.'})
            after = args.model_dump(mode='json', exclude={'id'})
            id = before['id'] if before else str(uuid4())
            after['id'] = id
            token, now = secrets.token_urlsafe(32), datetime.now(timezone.utc)
            from app.agent import digest
            expires = now + timedelta(minutes=10)
            changes = [{'id': id, 'before': json_row(before), 'after': after}]
            payload = {'kind': kind, 'changes': changes}
            c.execute(proposals.insert().values(token_hash=digest(token), owner_id=self.owner_id, payload=payload,
                expires_at=expires, status='pending'))
        return {'type': 'proposal', 'kind': kind, 'proposal_token': token, 'selected_ids': [id], 'changes': changes, 'expires_at': expires.isoformat()}

    def confirm(self, body):
        from app.agent import digest, utc, fail
        hash = digest(body.proposal_token)
        with self.engine.begin() as c:
            p = c.execute(select(proposals).where(proposals.c.token_hash == hash, proposals.c.owner_id == self.owner_id).with_for_update()).mappings().first()
            if not p:
                fail(403, 'AUTH_FAILED', 'Proposal is not available for this account.')
            if p['payload'].get('dismissed'):
                fail(409, 'PROPOSAL_CANCELLED', 'This preview was cancelled.')
            if p['status'] == 'applied':
                if p['idempotency_key'] != body.idempotency_key:
                    fail(409, 'PROPOSAL_ALREADY_APPLIED', 'Already confirmed with another key.')
                return p['result']
            replay = c.execute(select(proposals.c.token_hash).where(proposals.c.owner_id == self.owner_id, proposals.c.idempotency_key == body.idempotency_key)).first()
            if replay and replay[0] != hash:
                fail(409, 'IDEMPOTENCY_CONFLICT', 'This confirmation key belongs to another proposal.')
            if utc(p['expires_at']) <= datetime.now(timezone.utc):
                fail(409, 'PROPOSAL_EXPIRED', 'Preview expired. Request a new preview.')
            claimed = c.execute(proposals.update().where(proposals.c.token_hash == hash,
                proposals.c.status == 'pending', proposals.c.idempotency_key.is_(None))
                .values(idempotency_key=body.idempotency_key)).rowcount
            if not claimed:
                latest = c.execute(select(proposals).where(proposals.c.token_hash == hash)).mappings().one()
                if latest['status'] == 'applied' and latest['idempotency_key'] == body.idempotency_key:
                    return latest['result']
                fail(409, 'CONFIRMATION_CONFLICT', 'This preview is being confirmed. Retry with the same confirmation key.')
            payload, now = p['payload'], datetime.now(timezone.utc)
            if payload['kind'] == 'transaction_record':
                from app.agent import utc
                from app.routes.transactions import parse_row
                from sqlalchemy.dialects.postgresql import insert as pg_insert
                from sqlalchemy.dialects.sqlite import insert as sqlite_insert
                if payload['action']=='add':
                    row=parse_row({k:str(v) for k,v in payload['changes'][0]['after'].items()})
                    insert=pg_insert if c.dialect.name=='postgresql' else sqlite_insert
                    id=c.execute(insert(transactions).values(owner_id=self.owner_id,**row).on_conflict_do_nothing(index_elements=['owner_id','import_key']).returning(transactions.c.id)).scalar_one_or_none()
                    result={'status':'applied','kind':'transaction_record','updated_ids':[id] if id else [],'skipped_count':0 if id else 1}
                else:
                    ids=[s['id'] for s in payload['snapshots']]
                    rows=c.execute(select(transactions).where(transactions.c.owner_id==self.owner_id,transactions.c.id.in_(ids)).with_for_update()).mappings().all()
                    revisions={r['id']:utc(r['updated_at']).isoformat() for r in rows}
                    if any(revisions.get(s['id'])!=s['revision'] for s in payload['snapshots']):
                        fail(409,'PROPOSAL_STALE','A selected transaction changed. Request a fresh preview.')
                    c.execute(transactions.delete().where(transactions.c.owner_id==self.owner_id,transactions.c.id.in_(ids)))
                    result={'status':'applied','kind':'transaction_record','updated_ids':ids}
            elif payload['kind'] == 'document':
                from app.documents import apply_import
                result = apply_import(c, self.owner_id, payload)
            else:
                table = budgets if payload['kind'] == 'budget' else goals
                change = payload['changes'][0]
                scope = [table.c.owner_id == self.owner_id, table.c.id == change['id']]
                if payload['kind'] == 'budget':
                    scope = [budgets.c.owner_id == self.owner_id, budgets.c.category == change['after']['category']]
                row = c.execute(select(table).where(*scope).with_for_update()).mappings().first()
                if json_row(row) != change['before']:
                    fail(409, 'PROPOSAL_STALE', 'Planning data changed; request a fresh preview.')
                values = {**change['after'], 'owner_id': self.owner_id, 'updated_at': now}
                if row:
                    c.execute(table.update().where(*scope).values(**values))
                else:
                    c.execute(table.insert().values(**values))
                result = {'status': 'applied', 'kind': payload['kind'], 'updated_ids': [change['id']]}
            c.execute(proposals.update().where(proposals.c.token_hash == hash).values(status='applied', idempotency_key=body.idempotency_key, result=result))
            c.execute(audit.insert().values(id=str(uuid4()), owner_id=self.owner_id, proposal_hash=hash, changes=payload['changes'], confirmed_at=now))
        return result

def make_planning_router(engine):
    router = APIRouter()

    @router.get('/planning')
    def planning(identity=Depends(private_owner)):
        return PlanningService(engine, identity).read()

    @router.get('/analytics')
    def analytics(month: str, months: int = 6, category: Category | None = None, identity=Depends(private_owner)):
        return PlanningService(engine, identity).stats(StatsInput(month=month, months=months, category=category))

    @router.post('/planning/budget/preview')
    def budget(body: BudgetInput, identity=Depends(private_owner)):
        return PlanningService(engine, identity).prepare('budget', body)

    @router.post('/transactions/preview')
    def record(body:TransactionRecordInput,identity=Depends(private_owner)):
        return PlanningService(engine,identity).prepare_record(body)

    from app.agent import PrepareInput

    @router.post('/transactions/category/preview')
    def category_preview(body: PrepareInput, identity=Depends(private_owner)):
        from app.agent import AgentService
        # This is an explicit selection made in the transaction UI. Ownership and
        # revisions are still validated by the same preparation service as AI edits.
        return AgentService(engine, identity).prepare(body, set(body.transaction_ids))

    @router.post('/planning/goal/preview')
    def goal(body: GoalInput, identity=Depends(private_owner)):
        return PlanningService(engine, identity).prepare('goal', body)

    @router.post('/proposals/status')
    def status(body: ProposalToken, identity=Depends(private_owner)):
        from app.agent import digest, utc
        with engine.connect() as c:
            row = c.execute(select(proposals).where(proposals.c.token_hash == digest(body.proposal_token), proposals.c.owner_id == identity)).mappings().first()
        if not row:
            raise HTTPException(404, {'message': 'Proposal not found.'})
        value = 'dismissed' if row['payload'].get('dismissed') else row['status']
        if value == 'pending' and utc(row['expires_at']) <= datetime.now(timezone.utc):
            value = 'expired'
        return {'status': value}

    @router.post('/proposals/cancel')
    def cancel(body: ProposalToken, identity=Depends(private_owner)):
        from app.agent import digest
        with engine.begin() as c:
            row=c.execute(select(proposals).where(proposals.c.token_hash==digest(body.proposal_token),proposals.c.owner_id==identity).with_for_update()).mappings().first()
            if not row or row['status']!='pending':
                raise HTTPException(409, {'message':'Preview is unavailable or already confirmed.'})
            c.execute(proposals.update().where(proposals.c.token_hash==row['token_hash']).values(payload={**row['payload'],'dismissed':True}))
        return {'status':'dismissed'}

    return router
