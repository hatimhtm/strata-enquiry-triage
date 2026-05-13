/* Node test suite for the browser-side pure logic.
 *
 * Run with: node --test web/triage-core.test.mjs
 * Requires Node 18+ (built-in `node:test` and `fetch`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIES,
  SYSTEM_PROMPT,
  emptyResult,
  parseModelJson,
  normaliseResult,
  callAnthropic,
} from "./triage-core.js";

/* ─── CATEGORIES / SYSTEM_PROMPT shape ─────────────────────────── */

test("CATEGORIES is a closed set of six", () => {
  assert.equal(CATEGORIES.length, 6);
  assert.ok(CATEGORIES.includes("spam_or_unclear"));
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});

test("system prompt references every category", () => {
  for (const cat of CATEGORIES) {
    assert.ok(SYSTEM_PROMPT.includes(cat), `category ${cat} missing from prompt`);
  }
});

test("system prompt carries the anti-hallucination rule", () => {
  assert.ok(SYSTEM_PROMPT.includes("Never invent facts"));
});

test("system prompt carries the ambiguity-confidence rule", () => {
  assert.ok(SYSTEM_PROMPT.includes("Lower your confidence"));
});

/* ─── parseModelJson ───────────────────────────────────────────── */

test("parseModelJson handles bare JSON", () => {
  const r = parseModelJson('{"category":"complaint"}');
  assert.equal(r.category, "complaint");
});

test("parseModelJson strips a ```json fence", () => {
  const r = parseModelJson('```json\n{"category":"complaint"}\n```');
  assert.equal(r.category, "complaint");
});

test("parseModelJson strips a bare ``` fence", () => {
  const r = parseModelJson('```\n{"category":"complaint"}\n```');
  assert.equal(r.category, "complaint");
});

test("parseModelJson throws on garbage", () => {
  assert.throws(() => parseModelJson("definitely not json"), /non-JSON/);
});

/* ─── normaliseResult ──────────────────────────────────────────── */

test("normaliseResult fills defaults for missing fields", () => {
  const r = normaliseResult({});
  assert.equal(r.category, "spam_or_unclear");
  assert.equal(r.confidence, 0);
  assert.equal(r.urgency, "normal");
  assert.deepEqual(r.flags, []);
});

test("normaliseResult coerces confidence", () => {
  const r = normaliseResult({ confidence: "not a number" });
  assert.equal(r.confidence, 0);
});

test("normaliseResult preserves all fields when present", () => {
  const input = {
    category: "complaint",
    confidence: 0.91,
    urgency: "high",
    sender_intent: "Fix the leak",
    suggested_reply: "Hi there",
    recommended_action: "Escalate",
    flags: ["contains_pii"],
  };
  const r = normaliseResult(input);
  assert.deepEqual(r, input);
});

/* ─── emptyResult ──────────────────────────────────────────────── */

test("emptyResult is the spam_or_unclear short-circuit", () => {
  const r = emptyResult();
  assert.equal(r.category, "spam_or_unclear");
  assert.ok(r.flags.includes("ambiguous_input"));
});

/* ─── callAnthropic with a fake fetch ──────────────────────────── */

function makeFakeFetch({ status = 200, body = "" } = {}) {
  return async (url, init) => {
    fakeFetch.lastCall = { url, init };
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return JSON.parse(body);
      },
      async text() {
        return body;
      },
    };
  };
}
const fakeFetch = makeFakeFetch();

test("callAnthropic sends required headers and body", async () => {
  const payload = {
    content: [{ text: '{"category":"complaint","confidence":0.9,"urgency":"high","flags":[]}' }],
  };
  let captured;
  const fake = async (url, init) => {
    captured = { url, init };
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  };

  const result = await callAnthropic("sk-ant-test", "Water leak", fake);

  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["x-api-key"], "sk-ant-test");
  assert.equal(captured.init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");

  const body = JSON.parse(captured.init.body);
  assert.equal(body.system, SYSTEM_PROMPT);
  assert.ok(body.messages[0].content.includes("<enquiry>"));
  assert.ok(body.messages[0].content.includes("Water leak"));

  assert.equal(result.category, "complaint");
  assert.equal(result.urgency, "high");
});

test("callAnthropic surfaces a non-2xx error with status + body preview", async () => {
  const fake = async () => ({
    ok: false,
    status: 401,
    async json() {
      throw new Error("should not be called");
    },
    async text() {
      return '{"error":"invalid api key"}';
    },
  });
  await assert.rejects(() => callAnthropic("bad", "anything", fake), /Anthropic API 401/);
});

test("callAnthropic throws when the model returns non-JSON", async () => {
  const fake = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { content: [{ text: "definitely not json" }] };
    },
    async text() {
      return '{"content":[{"text":"definitely not json"}]}';
    },
  });
  await assert.rejects(() => callAnthropic("sk", "anything", fake), /non-JSON/);
});

/* ─── Drift guard: Python ↔ JS prompt parity ───────────────────── */

test("system prompt and category list match the Python source", async () => {
  // Read triage.py and confirm its SYSTEM_PROMPT and CATEGORIES match
  // the JS source byte-for-byte on the load-bearing rules.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const pyPath = path.resolve(here, "..", "triage.py");
  const py = await fs.readFile(pyPath, "utf-8");

  for (const cat of CATEGORIES) {
    assert.ok(py.includes(`"${cat}"`), `Python CATEGORIES missing ${cat}`);
  }
  // Critical rules must appear verbatim in both.
  assert.ok(py.includes("Never invent facts"), "anti-hallucination rule missing in Python");
  assert.ok(py.includes("Lower your confidence"), "ambiguity-confidence rule missing in Python");
});
