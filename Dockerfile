FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
# (tzdata pip package supplies the zoneinfo data for Asia/Kathmandu timestamps.)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SQLite databases live here; in production this is the SAME Pi HDD volume the
# original nepal-pos container mounts (shared live database). Created so the
# app can write even before the volume exists.
RUN mkdir -p /app/data

EXPOSE 5000

# One worker with threads keeps this app's SQLite access inside a single
# process; cross-APP concurrency with the original container is handled by
# WAL mode + busy timeout in db.py.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--worker-class", "gthread", "--access-logfile", "-", "app:app"]
