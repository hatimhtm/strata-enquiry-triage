"""
Strata enquiry triage — CLI tool.

Reads a client enquiry (from --text, --file, or stdin), asks an LLM to
classify it and draft a suggested response, and prints a usable result
for the staff member.

Usage:
    python triage.py --text "Hi, I'd like a quote for managing a 40-lot building in Bondi."
    python triage.py --file examples/complaint.txt
    cat enquiry.txt | python triage.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import textwrap
from dataclasses import dataclass

try:
    from anthropic import Anthropic, APIError, APIConnectionError, RateLimitError
except ImportError:
    sys.stderr.write("Missing dependency. Run: pip install -r requirements.txt\n")
    sys.exit(2)


MODEL = "claude-sonnet-4-5"

CATEGORIES = [
    "new_client",
    "support_request",
    "complaint",
    "billing_question",
    "general_question",
    "spam_or_unclear",
]

SYSTEM_PROMPT = f"""You are an enquiry-triage assistant for Strata Management Consultants,
an Australian strata management firm. Staff receive enquiries from owners,
committee members, prospective clients, and contractors.

Your job is to read one enquiry and return a strict JSON object with these fields:

- category: one of {CATEGORIES}
- confidence: float 0.0-1.0 reflecting how certain you are of the category
- urgency: "low" | "normal" | "high" (high = safety, legal threat, financial deadline, AGM date)
- sender_intent: a single short sentence describing what the sender actually wants
- suggested_reply: a polite draft reply the staff member can edit and send. Australian English. Sign as "Strata Management Consultants". Do not invent specific dates, dollar figures, lot numbers, or staff names.
- recommended_action: a short instruction for the staff member (e.g. "Route to the building manager for Lot 42", "Reply directly using draft", "Escalate to legal — possible NCAT matter")
- flags: array of any of ["needs_human_review", "contains_pii", "ambiguous_input", "out_of_scope"]

Rules:
- If the input is empty, gibberish, or clearly not an enquiry, return category "spam_or_unclear" with confidence 0.95 and flag "ambiguous_input".
- Never invent facts the sender did not state. If you don't know, ask in the suggested reply.
- Lower your confidence (<0.7) when the enquiry could plausibly fit two categories — staff will read confidence and route accordingly.
- Output ONLY the JSON object. No prose, no markdown fences.
"""


@dataclass
class TriageResult:
    category: str
    confidence: float
    urgency: str
    sender_intent: str
    suggested_reply: str
    recommended_action: str
    flags: list[str]

    @classmethod
    def from_dict(cls, data: dict) -> "TriageResult":
        return cls(
            category=str(data.get("category", "spam_or_unclear")),
            confidence=float(data.get("confidence", 0.0)),
            urgency=str(data.get("urgency", "normal")),
            sender_intent=str(data.get("sender_intent", "")),
            suggested_reply=str(data.get("suggested_reply", "")),
            recommended_action=str(data.get("recommended_action", "")),
            flags=list(data.get("flags", [])),
        )


def triage(enquiry: str, client: Anthropic) -> TriageResult:
    enquiry = (enquiry or "").strip()
    if not enquiry:
        return TriageResult(
            category="spam_or_unclear",
            confidence=1.0,
            urgency="low",
            sender_intent="",
            suggested_reply="",
            recommended_action="Discard — empty input.",
            flags=["ambiguous_input"],
        )

    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"<enquiry>\n{enquiry}\n</enquiry>"}],
    )

    raw = response.content[0].text.strip()
    # Tolerate a stray ```json fence if the model adds one despite instructions.
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        raw = raw.rsplit("```", 1)[0]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Model returned non-JSON output: {raw[:200]}") from exc

    return TriageResult.from_dict(data)


def render(result: TriageResult, enquiry: str) -> str:
    bar = "─" * 64
    out = [
        bar,
        f"  ENQUIRY  {textwrap.shorten(enquiry, 56)}",
        bar,
        f"  Category   : {result.category}  (confidence {result.confidence:.2f})",
        f"  Urgency    : {result.urgency}",
        f"  Intent     : {result.sender_intent}",
        f"  Flags      : {', '.join(result.flags) or '—'}",
        f"  Action     : {result.recommended_action}",
        "",
        "  ── Suggested reply ──",
    ]
    for line in textwrap.wrap(result.suggested_reply, width=62) or [""]:
        out.append(f"  {line}")
    out.append(bar)
    return "\n".join(out)


def read_input(args: argparse.Namespace) -> str:
    if args.text:
        return args.text
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            return f.read()
    if not sys.stdin.isatty():
        return sys.stdin.read()
    sys.stderr.write("No input. Provide --text, --file, or pipe via stdin.\n")
    sys.exit(2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Triage a client enquiry with Claude.")
    parser.add_argument("--text", help="Enquiry text passed inline.")
    parser.add_argument("--file", help="Path to a file containing the enquiry.")
    parser.add_argument(
        "--json", action="store_true", help="Emit raw JSON instead of formatted output."
    )
    args = parser.parse_args()

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        sys.stderr.write(
            "Set ANTHROPIC_API_KEY in your environment (.env supported).\n"
        )
        return 2

    enquiry = read_input(args)
    client = Anthropic(api_key=api_key)

    try:
        result = triage(enquiry, client)
    except RateLimitError:
        sys.stderr.write("Rate limited by Anthropic API. Retry shortly.\n")
        return 3
    except APIConnectionError as exc:
        sys.stderr.write(f"Connection error: {exc}\n")
        return 3
    except APIError as exc:
        sys.stderr.write(f"API error: {exc}\n")
        return 3
    except RuntimeError as exc:
        sys.stderr.write(f"{exc}\n")
        return 4

    if args.json:
        print(json.dumps(result.__dict__, indent=2))
    else:
        print(render(result, enquiry))
    return 0


if __name__ == "__main__":
    sys.exit(main())
