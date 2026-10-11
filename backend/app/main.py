import os
from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from sqlalchemy import create_engine, text

# 1. Load environment variables FIRST
load_dotenv()

# 2. Then grab the URL and create the engine
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)

app = FastAPI(title="FlowLedger API")

class ChatRequest(BaseModel):
    message: str

@app.get("/health")
def health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception as e:
        db_status = f"disconnected: {str(e)}"
        
    return {
        "status": "ok", 
        "service": "flowledger-api",
        "database": db_status
    }

@app.post("/agent/chat")
def agent_chat(request: ChatRequest):
    client = genai.Client() 
    response = client.models.generate_content(
        model='gemini-3.8-flash',
        contents=request.message,
    )
    return {"response": response.text}