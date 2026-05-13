"""Unit tests for triage.py — Anthropic client is mocked, no network calls."""

from __future__ import annotations

import json

import pytest

import triage as triage_mod
from triage import CATEGORIES, SYSTEM_PROMPT, TriageResult, render, triage

# ─── CATEGORIES / SYSTEM_PROMPT shape ──────────────────────────────────


def test_categories_is_a_closed_set_of_six():
    assert len(CATEGORIES) == 6
    assert "spam_or_unclear" in CATEGORIES
    # No accidental duplicates.
    assert len(set(CATEGORIES)) == len(CATEGORIES)


def test_system_prompt_mentions_every_category():
    # If a category is added to the list but not surfaced in the prompt,
    # the model has no idea it exists. This catches that drift.
    for cat in CATEGORIES:
        assert cat in SYSTEM_PROMPT, f"category {cat!r} not referenced in system prompt"


def test_system_prompt_has_anti_hallucination_rule():
    assert "Never invent facts" in SYSTEM_PROMPT


def test_system_prompt_has_ambiguity_confidence_rule():
    # The "lower your confidence" rule is the load-bearing one for downstream routing.
    assert "Lower your confidence" in SYSTEM_PROMPT


# ─── TriageResult.from_dict ────────────────────────────────────────────


def test_from_dict_with_all_fields(sample_payload):
    r = TriageResult.from_dict(sample_payload)
    assert r.category == "complaint"
    assert r.confidence == pytest.approx(0.92)
    assert r.urgency == "high"
    assert r.flags == ["contains_pii"]


def test_from_dict_with_missing_fields_uses_safe_defaults():
    r = TriageResult.from_dict({})
    assert r.category == "spam_or_unclear"  # fail-closed default
    assert r.confidence == 0.0
    assert r.urgency == "normal"
    assert r.flags == []


def test_from_dict_coerces_types():
    # Model occasionally returns confidence as a string in older models.
    r = TriageResult.from_dict({"confidence": "0.7", "flags": ("a", "b")})
    assert isinstance(r.confidence, float)
    assert r.flags == ["a", "b"]


# ─── triage() — empty input short-circuit ──────────────────────────────


def test_empty_string_short_circuits_without_api_call(fake_client):
    client = fake_client("never used")
    result = triage("", client)
    assert result.category == "spam_or_unclear"
    assert "ambiguous_input" in result.flags
    client.messages.create.assert_not_called()


def test_whitespace_only_short_circuits(fake_client):
    client = fake_client("never used")
    result = triage("   \n\t  ", client)
    assert result.category == "spam_or_unclear"
    client.messages.create.assert_not_called()


# ─── triage() — happy path ─────────────────────────────────────────────


def test_happy_path_parses_model_json(fake_client, sample_payload):
    client = fake_client(sample_payload)
    result = triage("Water leak in lot 14, please help.", client)
    assert result.category == "complaint"
    assert result.urgency == "high"
    client.messages.create.assert_called_once()


def test_happy_path_sends_enquiry_wrapped_in_tags(fake_client, sample_payload):
    client = fake_client(sample_payload)
    triage("Quote for a 40-lot building?", client)
    call = client.messages.create.call_args
    user_message = call.kwargs["messages"][0]["content"]
    assert "<enquiry>" in user_message and "</enquiry>" in user_message
    assert "Quote for a 40-lot building?" in user_message


def test_happy_path_uses_system_prompt(fake_client, sample_payload):
    client = fake_client(sample_payload)
    triage("Anything", client)
    call = client.messages.create.call_args
    assert call.kwargs["system"] == SYSTEM_PROMPT


# ─── triage() — markdown-fence tolerance ───────────────────────────────


def test_strips_json_code_fence(fake_client, sample_payload):
    raw = f"```json\n{json.dumps(sample_payload)}\n```"
    client = fake_client(raw)
    result = triage("anything", client)
    assert result.category == "complaint"


def test_strips_bare_code_fence(fake_client, sample_payload):
    raw = f"```\n{json.dumps(sample_payload)}\n```"
    client = fake_client(raw)
    result = triage("anything", client)
    assert result.category == "complaint"


# ─── triage() — bad model output ───────────────────────────────────────


def test_invalid_json_raises_runtime_error(fake_client):
    client = fake_client("totally not json at all")
    with pytest.raises(RuntimeError, match="non-JSON"):
        triage("anything", client)


# ─── render() — formatted output ───────────────────────────────────────


def test_render_includes_key_fields(sample_payload):
    r = TriageResult.from_dict(sample_payload)
    text = render(r, "Water leak in lot 14")
    assert "complaint" in text
    assert "0.92" in text
    assert "high" in text
    assert "Suggested reply" in text
    assert "contains_pii" in text


def test_render_shows_dash_when_no_flags():
    r = TriageResult.from_dict({"category": "general_question", "flags": []})
    text = render(r, "hi")
    assert "—" in text  # em-dash placeholder for the empty Flags row


# ─── read_input() — file mode ──────────────────────────────────────────


def test_read_input_from_file(tmp_path):
    f = tmp_path / "enquiry.txt"
    f.write_text("Hi from a file", encoding="utf-8")
    args = type("Args", (), {"text": None, "file": str(f)})()
    assert triage_mod.read_input(args).strip() == "Hi from a file"


def test_read_input_from_text_arg():
    args = type("Args", (), {"text": "inline enquiry", "file": None})()
    assert triage_mod.read_input(args) == "inline enquiry"
