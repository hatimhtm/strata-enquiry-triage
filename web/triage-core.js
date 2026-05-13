/* Pure logic shared between the browser app and the Node test suite.
 *
 * Kept in lock-step with `triage.py` — the same closed category enum,
 * the same system prompt rules, the same empty-input short-circuit. If
 * you change the Python contract, change this too (and the test catches
 * the drift).
 */

export const MODEL = "claude-sonnet-4-5";

export const CATEGORIES = [
  "new_client",
  "support_request",
  "complaint",
  "billing_question",
  "general_question",
  "spam_or_unclear",
];

export const SYSTEM_PROMPT = `You are an enquiry-triage assistant for Strata Management Consultants,
an Australian strata management firm. Staff receive enquiries from owners,
committee members, prospective clients, and contractors.

Your job is to read one enquiry and return a strict JSON object with these fields:

- category: one of ${JSON.stringify(CATEGORIES)}
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
- Output ONLY the JSON object. No prose, no markdown fences.`;

export function emptyResult() {
  return {
    category: "spam_or_unclear",
    confidence: 1.0,
    urgency: "low",
    sender_intent: "",
    suggested_reply: "",
    recommended_action: "Discard — empty input.",
    flags: ["ambiguous_input"],
  };
}

/** Strip a markdown fence the model occasionally adds, then JSON.parse.
 *  Throws if the cleaned string isn't valid JSON.
 */
export function parseModelJson(raw) {
  let s = String(raw).trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    return JSON.parse(s);
  } catch {
    throw new Error(`Model returned non-JSON: ${s.slice(0, 200)}`);
  }
}

/** Normalise a model response into a TriageResult-shaped object with safe defaults. */
export function normaliseResult(data) {
  const d = data || {};
  return {
    category: String(d.category ?? "spam_or_unclear"),
    confidence: Number.isFinite(d.confidence) ? Number(d.confidence) : 0.0,
    urgency: String(d.urgency ?? "normal"),
    sender_intent: String(d.sender_intent ?? ""),
    suggested_reply: String(d.suggested_reply ?? ""),
    recommended_action: String(d.recommended_action ?? ""),
    flags: Array.isArray(d.flags) ? d.flags.map(String) : [],
  };
}

/** Call the Anthropic Messages API from the browser. Returns a normalised result. */
export async function callAnthropic(apiKey, enquiry, fetchImpl = fetch) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `<enquiry>\n${enquiry}\n</enquiry>` }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 240)}`);
  }
  const data = await res.json();
  const raw = (data?.content?.[0]?.text || "").trim();
  return normaliseResult(parseModelJson(raw));
}
