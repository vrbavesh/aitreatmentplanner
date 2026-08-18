# LLD v2 §1/§3 — FastAPI app init, three routers mounted (the only endpoints).
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import extract, predict, similar

app = FastAPI(
    title="AI-Assisted Treatment Recommendation System",
    description="Upload → Extract → Predict → Doctor Approves → Patient Sees Plan",
    version="0.1.0",
)

# CORS: the Next.js frontend calls these endpoints from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract.router)
app.include_router(predict.router)
app.include_router(similar.router)