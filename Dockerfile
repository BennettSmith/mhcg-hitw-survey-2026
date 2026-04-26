# Survey photo viewer (FastAPI + uvicorn).
# Expects /work/survey_photos.yaml at runtime. Photos can be mounted locally or fetched from PHOTO_REMOTE_BASE_URL and cached.
FROM python:3.12-slim-bookworm

WORKDIR /work

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir --root-user-action=ignore -r requirements.txt

COPY webapp/ webapp/
COPY track/ track/
COPY survey_photos.yaml .

RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /work
USER app

EXPOSE 8000

# Render and other hosts set PORT; default 8000 for local `docker run`.
CMD ["sh", "-c", "exec uvicorn webapp.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
