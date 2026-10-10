from fastapi import FastAPI

app = FastAPI(title="FlowLedger API")

@app.get("/health")
def health():
    return {"status": "ok", "service": "flowledger-api"}
