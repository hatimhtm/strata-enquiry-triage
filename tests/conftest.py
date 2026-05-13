"""Shared fixtures for the triage test suite."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def sample_payload() -> dict:
    """A canonical valid model response, used across most tests."""
    return {
        "category": "complaint",
        "confidence": 0.92,
        "urgency": "high",
        "sender_intent": "Resolve a recurring ceiling leak before escalating to NCAT.",
        "suggested_reply": "Hi Sarah, thank you for getting in touch...",
        "recommended_action": "Escalate to the building manager today.",
        "flags": ["contains_pii"],
    }


def _fake_client(raw_text: str) -> MagicMock:
    """Build a MagicMock that mimics the shape returned by the Anthropic SDK."""
    block = SimpleNamespace(text=raw_text)
    response = SimpleNamespace(content=[block])
    client = MagicMock()
    client.messages.create.return_value = response
    return client


@pytest.fixture
def fake_client():
    """Factory fixture — call with the raw text the 'model' should return."""

    def _build(raw: str | dict) -> MagicMock:
        if isinstance(raw, dict):
            raw = json.dumps(raw)
        return _fake_client(raw)

    return _build
