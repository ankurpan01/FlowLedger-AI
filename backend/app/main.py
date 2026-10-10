import os
from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai

# 1. Load the secret variables from the .env file
load_dotenv()

# 2. Start the server and the AI client
app = FastAPI(title="FlowLedger API")
client = genai.Client() # Automatically finds the GEMINI_API_KEY in your .env

# 3. Define what the frontend will send us
class ChatRequest(BaseModel):
    message: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "flowledger-api"}

@app.post("/agent/chat")
def agent_chat(request: ChatRequest):
    # 4. Send the user's message to Gemini 2.5 Flash
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=request.message,
    )
    # 5. Send Gemini's answer back to the frontend
    return {"response": response.text}