import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Response, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
from app.routes.transactions import make_router
from app.agent import AgentService, ChatRequest, ConfirmRequest, GeminiSession
from app.forecast import ForecastRequest, ForecastService
from app.public_limits import PublicDemoLimits
from app.workspace import WorkspaceAccess, make_workspace_router, owner
from app.planning import make_planning_router

# Resolve backend/.env independently of the shell's working directory.
# Existing process environment variables retain precedence.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

def create_app(database_url: str | None = None, agent_session_factory=None) -> FastAPI:
    """Create the starter API without connecting or modifying the database."""
    database_url = os.getenv("DATABASE_URL") if database_url is None else database_url
    engine = None
    db_status = "not_configured"
    if database_url:
        try:
            url = make_url(database_url)
            # Provider URLs commonly omit the driver; we install psycopg 3.
            if url.drivername in {"postgres", "postgresql"}:
                url = url.set(drivername="postgresql+psycopg")
            connect_args = {"connect_timeout": 5} if url.get_backend_name() == "postgresql" else {}
            engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args)
        except (SQLAlchemyError, ValueError, ImportError):
            # Connection URLs and driver errors may contain secrets.
            db_status = "configuration_error"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            if engine is not None:
                engine.dispose()

    app = FastAPI(title="FlowLedger API", lifespan=lifespan)
    app.state.engine = engine
    app.add_middleware(WorkspaceAccess, engine=engine, demo_owner=os.getenv('DEMO_USER_ID', 'demo-user-001'))
    if os.getenv("PUBLIC_DEMO", "false").lower() == "true":
        app.add_middleware(PublicDemoLimits)
    origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").split(",") if origin.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH"], allow_headers=["Content-Type", "Authorization"])

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return JSONResponse(error.detail if isinstance(error.detail, dict) else {"message": str(error.detail)}, status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        return JSONResponse({"error_code": "VALIDATION_ERROR", "message": "Invalid request.", "details": [
            {"field": ".".join(map(str, item["loc"])), "issue": item["type"]} for item in error.errors()
        ]}, status_code=400)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, error: SQLAlchemyError):
        return JSONResponse({"error_code": "DATABASE_UNAVAILABLE", "message": "Database is unavailable or schema setup is required."}, status_code=503)

    # Shared demo context is server-controlled, never a browser-supplied user ID.
    app.include_router(make_router(engine, os.getenv("DEMO_USER_ID", "demo-user-001")))
    app.include_router(make_workspace_router(engine, os.getenv('DEMO_USER_ID', 'demo-user-001')))
    app.include_router(make_planning_router(engine))
    from app.documents import make_document_router
    app.include_router(make_document_router(engine))
    from app.predictive import make_predictive_router
    app.include_router(make_predictive_router(engine))
    agent = AgentService(engine, os.getenv("DEMO_USER_ID", "demo-user-001"), agent_session_factory or GeminiSession)
    app.state.agent = agent

    @app.get("/health")
    def health(response: Response):
        current_status = db_status
        if engine is not None:
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                current_status = "connected"
            except SQLAlchemyError:
                current_status = "disconnected"
        ready = current_status == "connected"
        response.status_code = 200 if ready else 503
        return {
            "status": "ok" if ready else "unavailable",
            "service": "flowledger-api",
            "database": current_status,
        }

    @app.post("/agent/chat")
    def agent_chat(body: ChatRequest, request: Request):
        service = AgentService(engine, owner(request), agent_session_factory or GeminiSession)
        if body.conversation_id:
            from app.memory import persistent_chat
            try:
                return persistent_chat(service, body)
            except IntegrityError:
                raise HTTPException(409, {'message': 'This message is already processing. Retry with the same request ID.'}) from None
        return service.chat(body.message)

    @app.post("/agent/confirm")
    def agent_confirm(body: ConfirmRequest, request: Request):
        return AgentService(engine, owner(request), agent_session_factory or GeminiSession).confirm(body)

    @app.post("/ml/forecast")
    def spending_forecast(body: ForecastRequest, request: Request):
        if owner(request).startswith('workspace-'):
            from app.predictive import PredictiveService
            return PredictiveService(engine, owner(request)).predict(body)['forecast']
        return ForecastService(engine, owner(request)).forecast(body)

    return app


app = create_app()
