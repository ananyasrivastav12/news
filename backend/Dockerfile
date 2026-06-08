FROM python:3.12-slim

WORKDIR /usr/src/app

# System deps for any packages that might need compilation on aarch64
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential gcc \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt

COPY . .

# If your app uses gunicorn in prod, keep it. For dev, compose usually runs uvicorn.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
