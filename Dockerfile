# Survey photo viewer (FastAPI + uvicorn).
# Expects /work/survey_photos.yaml and /work/photos at runtime; GPX is baked in and can be overridden by mounting ./track (see docker-compose.yml).
FROM python:3.12-slim-bookworm

WORKDIR /work

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY webapp/ webapp/
COPY track/ track/
COPY survey_photos.yaml .
COPY photos/ photos/

RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /work
USER app

EXPOSE 8000

# Render and other hosts set PORT; default 8000 for local `docker run`.
CMD ["sh", "-c", "exec uvicorn webapp.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
