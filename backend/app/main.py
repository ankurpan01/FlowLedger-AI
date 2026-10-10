import os
from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai

load_dotenv()

app = FastAPI(title="FlowLedger API")

class ChatRequest(BaseModel):
    message: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "flowledger-api"}

@app.post("/agent/chat")
def agent_chat(request: ChatRequest):
    # We moved the client inside the route so it doesn't freeze the server!
    client = genai.Client() 
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=request.message,
    )
    return {"response": response.text}