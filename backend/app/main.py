# In app/main.py

from fastapi import FastAPI

from app.api.endpoints import interests, login, news, users

app = FastAPI(title="News Summarizer API")

# Include the routers
app.include_router(login.router, prefix="/api", tags=["Login"])
app.include_router(users.router, prefix="/api", tags=["Users"])
app.include_router(interests.router, prefix="/api", tags=["Interests"])
app.include_router(news.router, prefix="/api", tags=["News"])


@app.get("/health")
async def healthcheck():
    return {"status": "ok"}
