from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.endpoints import dev, interests, login, news, users
from app.core.config import settings

app = FastAPI(title="News Summarizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(login.router, prefix="/api", tags=["login"])
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(interests.router, prefix="/api", tags=["interests"])
app.include_router(news.router, prefix="/api", tags=["news"])
app.include_router(dev.router, prefix="/api", tags=["dev"])


@app.get("/health")
def health():
    return {"status": "ok"}
