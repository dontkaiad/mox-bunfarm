# 🐇 Mox BunFarm

Estimates rabbit count in farm zones from sign observations — tracks, holes, sensors.
Record what you spotted; the model collapses duplicates, adjusts for cross-zone movement,
and gives a probability-weighted count with a confidence score.

AI recommendations (Claude Haiku) fire automatically when events change.

## Stack

- **Frontend**: React 19 + Vite — Stardew Valley aesthetic, Russian UI
- **Backend**: FastAPI + Anthropic Claude Haiku

## Local dev

**Frontend only** — the model runs in-browser; the API falls back gracefully when absent:

```sh
npm install
npm run dev          # http://localhost:5173
```

**With AI backend**:

```sh
cd api
cp .env.example .env        # fill in ANTHROPIC_API_KEY
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

## Production (Docker Compose)

```sh
cp api/.env.example .env    # add ANTHROPIC_API_KEY
docker compose up -d
```

The API is not exposed on the public host — only Caddy on the internal Docker network can reach it (`expose:` not `ports:`).

## Tests

```sh
npm test    # 37 model unit tests
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) |

See `api/.env.example` for the template.
