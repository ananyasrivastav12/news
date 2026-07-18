from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.endpoints import admin, dev, interests, login, news, users
from app.core.config import settings
from app.db.session import SessionLocal
from app.services.admin_bootstrap import bootstrap_admin_user


def _bootstrap_admin() -> None:
    db = SessionLocal()
    try:
        bootstrap_admin_user(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _bootstrap_admin()
    yield


app = FastAPI(title="News Summarizer API", lifespan=lifespan)

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
app.include_router(admin.router, prefix="/api", tags=["admin"])


@app.get("/health")
def health():
    return {"status": "ok"}
