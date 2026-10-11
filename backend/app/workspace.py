"""Private prototype workspaces. Recovery keys are bearer credentials, stored hashed."""
import hashlib
import secrets
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, JSON, String, Table, UniqueConstraint, select
from app.db import metadata, transactions

accounts = Table('flowledger_workspaces', metadata,
    Column('id', String(128), primary_key=True), Column('key_hash', String(64), unique=True, nullable=False),
    Column('name', String(80), nullable=False), Column('preferences', JSON, nullable=False),
    Column('created_at', DateTime(timezone=True), nullable=False))
conversations = Table('flowledger_conversations', metadata,
    Column('id', String(36), primary_key=True), Column('owner_id', String(128), nullable=False, index=True),
    Column('title', String(100), nullable=False), Column('created_at', DateTime(timezone=True), nullable=False),
    Column('updated_at', DateTime(timezone=True), nullable=False))
turns = Table('flowledger_chat_turns', metadata,
    Column('id', String(36), primary_key=True), Column('conversation_id', String(36), nullable=False, index=True),
    Column('owner_id', String(128), nullable=False), Column('request_id', String(128), nullable=False),
    Column('message', String(2000), nullable=False), Column('events', JSON, nullable=False),
    Column('status', String(20), nullable=False), Column('created_at', DateTime(timezone=True), nullable=False),
    UniqueConstraint('owner_id', 'request_id', name='uq_flowledger_chat_request'))

def owner(request: Request):
    return request.state.owner_id

def private_owner(request: Request):
    value = owner(request)
    if not value.startswith('workspace-'):
        raise HTTPException(401, {'message': 'Open a private workspace to use persistent history and planning.'})
    return value

class WorkspaceAccess:
    def __init__(self, app, engine, demo_owner):
        self.app, self.engine, self.demo_owner = app, engine, demo_owner

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] == 'OPTIONS':
            return await self.app(scope, receive, send)
        from starlette.responses import JSONResponse
        key = dict(scope.get('headers', [])).get(b'authorization', b'').decode()
        resolved = self.demo_owner
        if key:
            try:
                if not key.startswith('Bearer ') or self.engine is None:
                    raise ValueError()
                digest = hashlib.sha256(key[7:].encode()).hexdigest()
                with self.engine.connect() as connection:
                    resolved = connection.scalar(select(accounts.c.id).where(accounts.c.key_hash == digest))
                if not resolved:
                    raise ValueError()
            except ValueError:
                return await JSONResponse({'message': 'Workspace key is invalid.'}, status_code=401)(scope, receive, send)
            except Exception:
                return await JSONResponse({'message': 'Workspace access is temporarily unavailable.'}, status_code=503)(scope, receive, send)
        scope.setdefault('state', {})['owner_id'] = resolved
        return await self.app(scope, receive, send)

class NewWorkspace(BaseModel):
    name: str = Field(default='My workspace', min_length=1, max_length=80)
    seed_demo: bool = True

class Preferences(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    remember_context: bool = True

def make_workspace_router(engine, demo_owner):
    router = APIRouter()

    @router.post('/workspaces')
    def create(body: NewWorkspace):
        if engine is None:
            raise HTTPException(503, {'message': 'Database is not configured.'})
        key, identity, now = secrets.token_urlsafe(40), 'workspace-' + str(uuid4()), datetime.now(timezone.utc)
        with engine.begin() as connection:
            connection.execute(accounts.insert().values(id=identity, key_hash=hashlib.sha256(key.encode()).hexdigest(),
                name=body.name, preferences={'remember_context': True, 'currency': 'USD'}, created_at=now))
            from app.planning import budgets
            connection.execute(budgets.insert().values(id=str(uuid4()), owner_id=identity,
                category='Dining', amount_cents=5000, updated_at=now))
            if body.seed_demo:
                rows = connection.execute(select(transactions).where(transactions.c.owner_id == demo_owner)).mappings().all()
                for item in rows:
                    row = dict(item)
                    row.update(id=str(uuid4()), owner_id=identity, created_at=now, updated_at=now)
                    connection.execute(transactions.insert().values(**row))
        return {'workspace_key': key, 'workspace': {'id': identity, 'name': body.name}}

    @router.get('/workspaces/me')
    def me(identity=Depends(private_owner)):
        with engine.connect() as connection:
            row = connection.execute(select(accounts).where(accounts.c.id == identity)).mappings().one()
        return {'id': identity, 'name': row['name'], 'preferences': row['preferences']}

    @router.patch('/workspaces/me')
    def preferences(body: Preferences, identity=Depends(private_owner)):
        with engine.begin() as connection:
            connection.execute(accounts.update().where(accounts.c.id == identity).values(name=body.name,
                preferences={'remember_context': body.remember_context, 'currency': 'USD'}))
        return {'name': body.name, 'preferences': {'remember_context': body.remember_context, 'currency': 'USD'}}

    @router.get('/conversations')
    def history(identity=Depends(private_owner)):
        with engine.connect() as connection:
            rows = connection.execute(select(conversations).where(conversations.c.owner_id == identity)
                .order_by(conversations.c.updated_at.desc()).limit(100)).mappings().all()
        return {'conversations': [dict(row) for row in rows]}

    @router.post('/conversations')
    def new_conversation(identity=Depends(private_owner)):
        now, id = datetime.now(timezone.utc), str(uuid4())
        with engine.begin() as connection:
            connection.execute(conversations.insert().values(id=id, owner_id=identity, title='New conversation', created_at=now, updated_at=now))
        return {'id': id, 'title': 'New conversation'}

    @router.get('/conversations/{id}')
    def messages(id: str, identity=Depends(private_owner)):
        with engine.connect() as connection:
            chat = connection.execute(select(conversations).where(conversations.c.id == id, conversations.c.owner_id == identity)).mappings().first()
            if not chat:
                raise HTTPException(404, {'message': 'Conversation not found.'})
            rows = connection.execute(select(turns).where(turns.c.conversation_id == id, turns.c.owner_id == identity)
                .order_by(turns.c.created_at.desc(), turns.c.id.desc()).limit(200)).mappings().all()
        return {'conversation': dict(chat), 'turns': [dict(row) for row in reversed(rows)],
                'history_limit': 200}

    return router
