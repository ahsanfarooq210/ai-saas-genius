# AI Backend (FastAPI)

A production-ready FastAPI project scaffold with a modular structure inspired by common best practices.

## Project Structure

```text
ai-backend/
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   └── health.py
│   │       └── router.py
│   ├── core/
│   │   └── config.py
│   ├── db/
│   ├── models/
│   ├── schemas/
│   ├── services/
│   └── main.py
├── tests/
│   └── test_health.py
├── alembic.ini
├── .env.example
└── requirements.txt
```

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Run

```bash
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Auth APIs

- `POST /api/v1/auth/signup` creates a user account.
- `POST /api/v1/auth/signin` returns `access_token` and `refresh_token`.
- `POST /api/v1/auth/refresh` accepts a `refresh_token` and returns a new access/refresh token pair.
- `GET /api/v1/auth/me` requires `Authorization: Bearer <access_token>`.

## Migrations (Alembic)

```bash
# create a new migration after model changes
alembic revision --autogenerate -m "describe change"

# apply latest migrations
alembic upgrade head

# rollback one migration
alembic downgrade -1
```

## Test

```bash
pytest -q
```
