import asyncio
import json
import logging
import os

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="BunFarm API")

# Allow Vite dev server and production origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "https://bunfarm.heylark.dev"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)

SYSTEM_PROMPT = (
    "ты помощник фермера, который отслеживает присутствие кроликов по следам. "
    "По готовому расчёту дай 2-4 конкретных совета: куда сходить проверить в "
    "следующий раз, какие зоны или типы сигналов требуют дополнительного "
    "наблюдения, как улучшить точность оценки. "
    "НЕ рекомендуй ловушки, отпугиватели или методы поимки — цель наблюдение, "
    "а не борьба. Дай одно короткое объяснение текущей оценки простым языком. "
    "Всё на русском, без технического жаргона. "
    "Ответь строго в JSON без markdown-обёртки: "
    '{\"recommendations\": [\"...\"], \"explanation\": \"...\"}'
)

MODEL = "claude-haiku-4-5-20251001"
TIMEOUT_SECONDS = 10


class Event(BaseModel):
    id: int
    event: str
    location: str
    time: str
    count: int
    intensity: float


class Contribution(BaseModel):
    id: int
    percent: float


class Params(BaseModel):
    rabbitsPerUnit: dict[str, float]
    reliability: dict[str, float]
    movementWindowMinutes: int


class AdviseRequest(BaseModel):
    rabbits: float
    confidence: int
    events: list[Event]
    contributions: list[Contribution]
    byZone: dict[str, float]
    params: Params


FALLBACK_RESPONSE = {"source": "fallback", "recommendations": None, "explanation": None}


def _build_user_message(req: AdviseRequest) -> str:
    """Serialize the computed state into a compact JSON string for the prompt."""
    top_contributors = sorted(req.contributions, key=lambda c: c.percent, reverse=True)[:3]
    top_events = [
        {"event": next((e.event for e in req.events if e.id == c.id), "?"),
         "location": next((e.location for e in req.events if e.id == c.id), "?"),
         "percent": round(c.percent, 1)}
        for c in top_contributors
    ]
    payload = {
        "кроликов_всего": round(req.rabbits, 2),
        "уверенность_%": req.confidence,
        "по_зонам": {k: round(v, 2) for k, v in req.byZone.items()},
        "главные_сигналы": top_events,
        "пониженная_надёжность": [
            t for t, r in req.params.reliability.items() if r < 0.4
        ],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _call_claude(user_msg: str, api_key: str) -> str:
    """Synchronous Anthropic call — runs in a thread executor to support timeout."""
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=MODEL,
        max_tokens=512,
        temperature=0.2,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    return message.content[0].text


@app.post("/api/advise")
async def advise(req: AdviseRequest) -> dict:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        log.warning("ANTHROPIC_API_KEY not set — returning fallback")
        return FALLBACK_RESPONSE

    user_msg = _build_user_message(req)
    try:
        loop = asyncio.get_event_loop()
        raw_text = await asyncio.wait_for(
            loop.run_in_executor(None, _call_claude, user_msg, api_key),
            timeout=TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning("Anthropic call timed out after %ds", TIMEOUT_SECONDS)
        return FALLBACK_RESPONSE
    except Exception as exc:
        log.warning("Anthropic call failed: %s", exc)
        return FALLBACK_RESPONSE

    try:
        # Strip accidental markdown fences the model sometimes adds
        text = raw_text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        data = json.loads(text)
        return {
            "source": "llm",
            "recommendations": data.get("recommendations", []),
            "explanation": data.get("explanation", ""),
        }
    except Exception as exc:
        log.warning("Failed to parse LLM JSON: %s — raw: %.120s", exc, raw_text)
        return FALLBACK_RESPONSE


@app.get("/health")
def health() -> dict:
    return {"ok": True}
