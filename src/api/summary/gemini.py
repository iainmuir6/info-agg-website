"""
gemini.py

Minimal REST client for the Google Gemini API (generativelanguage.googleapis.com).

Deliberately not the `google-genai` SDK: this makes exactly one kind of call —
one prompt in, one JSON object out — and the SDK would add a dependency, a
transitive protobuf/grpc stack, and its own retry behaviour to a pipeline that
already has a wall-clock budget it must not blow (see CLAUDE.md).

Free tier as of 2026: ~1,500 requests/day, 15 RPM, 1M TPM on Flash. This module
is called once or twice a DAY, so the only limit that could ever bite is TPM,
and only if the caller stops trimming its context.
"""

from typing import Any, Dict, List, Optional
import json
import os
import requests

from dotenv import load_dotenv

load_dotenv()

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Ordered by RESPONSIVENESS, not by capability, and that is deliberate.
#
# Measured against this key on 2026-09-01: the headline Flash models are
# routinely capacity-limited on the free tier — gemini-3.7-flash took 29.6s to
# return a 503, gemini-flash-latest timed out at 30s, gemini-3.5-flash 503'd —
# while the lite models answered in under a second. Since this domain runs
# sequentially after the parallel block and counts directly against the <60s
# run requirement in CLAUDE.md, a model that usually works in 1s beats one
# that sometimes works in 20s. The work itself is extractive summarising of a
# context bundle we supply, which is well within lite's range.
#
# Override with GEMINI_MODEL to put a bigger model first; it is tried ahead of
# these and they remain as the fallback.
MODEL_CANDIDATES: List[str] = [
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
]

# Bounds the damage from the failure mode above: an overloaded model that
# takes half a minute to admit it would eat the run's whole budget on its own.
REQUEST_TIMEOUT_S = 12


class GeminiError(RuntimeError):
    """Raised when no candidate model produced a usable response."""


def get_gemini_api_key() -> Optional[str]:
    """Return the configured key, or None when the feature is unconfigured.

    Callers treat None as "skip this card", not as an error — the same way the
    misc domain treats a missing WEATHER_API_KEY.

    Deliberately does NOT fall back to GOOGLE_API_KEY the way media/youtube.py
    does. That variable already holds the YouTube Data API key, and the two are
    only interchangeable if one GCP key happens to have both APIs enabled.
    Borrowing it turns "Gemini isn't set up" — a clean skip — into a 403 from
    an unrelated service.
    """
    return os.getenv("GEMINI_API_KEY")


def _models_to_try() -> List[str]:
    configured = os.getenv("GEMINI_MODEL")
    if not configured:
        return MODEL_CANDIDATES
    return [configured] + [m for m in MODEL_CANDIDATES if m != configured]


def generate_json(
    prompt: str,
    schema: Dict[str, Any],
    system_instruction: Optional[str] = None,
    temperature: float = 0.3,
) -> Dict[str, Any]:
    """Ask Gemini for a single JSON object matching `schema`.

    Uses responseMimeType/responseSchema (structured output) rather than
    "reply in JSON" prompting: the model is constrained at decode time, so the
    result parses or the request failed — there is no half-JSON-in-prose case
    to defend against downstream.

    Returns the parsed object plus a `_model` key naming the model that served
    it. Raises GeminiError when every candidate failed.
    """
    api_key = get_gemini_api_key()
    if not api_key:
        raise GeminiError("GEMINI_API_KEY is not set")

    body: Dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            # Low but not zero: these are summaries of factual rows, and
            # greedy decoding on a digest tends toward repeating the same
            # phrasing for every bullet.
            "temperature": temperature,
        },
    }
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    failures: List[str] = []
    for model in _models_to_try():
        url = f"{API_BASE}/{model}:generateContent"
        try:
            resp = requests.post(
                url,
                headers={
                    "x-goog-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=REQUEST_TIMEOUT_S,
            )
        except requests.exceptions.RequestException as e:
            failures.append(f"{model}: {e}")
            continue

        # Fall through to the next candidate on the statuses that are about
        # THIS model rather than the request: 404 (id retired), 429 (this
        # model's quota) and 503 (this model overloaded — the free tier serves
        # 503 on the newest alias regularly, while an older pinned id answers
        # immediately). Everything else — 400 bad schema, 401/403 bad key — is
        # a property of the request and would fail identically on every model,
        # so it ends the attempt and the card serves its previous value rather
        # than burning the budget proving the point three times.
        if resp.status_code in (404, 429, 503):
            failures.append(f"{model}: HTTP {resp.status_code}")
            continue
        if resp.status_code != 200:
            failures.append(f"{model}: HTTP {resp.status_code} {resp.text[:200]}")
            break

        try:
            data = resp.json()
            candidates = data.get("candidates") or []
            if not candidates:
                # Usually a safety block or an empty finishReason.
                failures.append(f"{model}: no candidates ({json.dumps(data)[:200]})")
                break
            parts = (candidates[0].get("content") or {}).get("parts") or []
            text = "".join(p.get("text", "") for p in parts)
            parsed = json.loads(text)
        except (ValueError, KeyError, TypeError) as e:
            failures.append(f"{model}: unparseable response ({e})")
            break

        if not isinstance(parsed, dict):
            failures.append(f"{model}: expected an object, got {type(parsed).__name__}")
            break

        parsed["_model"] = model
        return parsed

    raise GeminiError("; ".join(failures) or "no models attempted")


if __name__ == "__main__":
    print("=" * 60)
    print("Testing Gemini API")
    print("=" * 60)

    if not get_gemini_api_key():
        print("GEMINI_API_KEY not set — nothing to test")
        raise SystemExit(0)

    out = generate_json(
        prompt="Name three colours of the visible spectrum.",
        schema={
            "type": "OBJECT",
            "properties": {"colours": {"type": "ARRAY", "items": {"type": "STRING"}}},
            "required": ["colours"],
        },
    )
    print(json.dumps(out, indent=2))
