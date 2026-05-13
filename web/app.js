/* TRIAGE — client-side web demo.
 *
 * The user's Anthropic API key lives in their browser's localStorage and
 * is sent straight from their machine to api.anthropic.com — no backend,
 * no server logs, no third party. Pure logic lives in triage-core.js so
 * the Node test suite can exercise it without a DOM.
 */

import { callAnthropic, emptyResult } from "./triage-core.js";

const STORAGE_KEY = "strata-triage:anthropic-api-key";

const SAMPLES = [
  `Hi team,

I'm on the committee for a 38-lot residential building in Pyrmont and we're
unhappy with our current strata manager. Could you send through your
management proposal and let me know what your fees look like for a building
our size? Happy to jump on a call this week if easier.

Cheers,
Mark Reilly`,
  `Subject: URGENT — water leak in Lot 14, no response for 3 days

I've called twice and emailed once and nobody has come out. There is water
coming through the ceiling of my bathroom from the unit above. The carpet
is now ruined. This is the third time in six months. If this is not
resolved by tomorrow I am going to NCAT.

Sarah Chen, Lot 14`,
  `Hi, could you please send me a copy of the minutes from the last AGM?
I missed the meeting and want to catch up on what was discussed.
Thanks, John (Lot 7)`,
  `asdkjf qwopei zxc 1234 ??? lorem ipsum`,
];

/* ─── DOM ────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const els = {
  enquiry: $("enquiry"),
  apiKey: $("apiKey"),
  showKeyBtn: $("showKeyBtn"),
  clearKeyBtn: $("clearKeyBtn"),
  runBtn: $("runBtn"),
  clearBtn: $("clearBtn"),
  loadSampleBtn: $("loadSampleBtn"),
  copyJsonBtn: $("copyJsonBtn"),
  status: $("status"),
  output: $("output"),
  config: $("config"),
};

let lastResult = null;
let sampleIdx = 0;

/* ─── API key handling ───────────────────────────────────────── */

function loadKey() {
  const k = localStorage.getItem(STORAGE_KEY);
  if (k) {
    els.apiKey.value = k;
    els.config.open = false;
  } else {
    els.config.open = true;
  }
}
function saveKey() {
  const k = els.apiKey.value.trim();
  if (k) localStorage.setItem(STORAGE_KEY, k);
}
function clearKey() {
  localStorage.removeItem(STORAGE_KEY);
  els.apiKey.value = "";
  setStatus("API key cleared.", "ok");
}

els.apiKey.addEventListener("change", saveKey);
els.apiKey.addEventListener("blur", saveKey);
els.showKeyBtn.addEventListener("click", () => {
  const t = els.apiKey.type;
  els.apiKey.type = t === "password" ? "text" : "password";
  els.showKeyBtn.textContent = t === "password" ? "Hide" : "Show";
});
els.clearKeyBtn.addEventListener("click", clearKey);

/* ─── Status helpers ─────────────────────────────────────────── */

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = "status " + kind;
}

/* ─── Sample loading ─────────────────────────────────────────── */

els.loadSampleBtn.addEventListener("click", () => {
  els.enquiry.value = SAMPLES[sampleIdx % SAMPLES.length];
  sampleIdx += 1;
  setStatus(`sample ${sampleIdx} loaded`, "ok");
});

els.clearBtn.addEventListener("click", () => {
  els.enquiry.value = "";
  els.output.innerHTML = '<p class="placeholder">No result yet. Paste an enquiry and click <strong>RUN TRIAGE</strong>.</p>';
  els.copyJsonBtn.disabled = true;
  lastResult = null;
  setStatus("");
});

/* ─── Run ────────────────────────────────────────────────────── */

els.runBtn.addEventListener("click", async () => {
  const enquiry = els.enquiry.value.trim();
  const apiKey = els.apiKey.value.trim();

  if (!enquiry) {
    renderResult(emptyResult());
    setStatus("empty input — short-circuited", "ok");
    return;
  }
  if (!apiKey) {
    setStatus("paste your anthropic key (config panel above) first", "error");
    els.config.open = true;
    return;
  }

  els.runBtn.disabled = true;
  setStatus("calling claude...", "ok");
  try {
    saveKey();
    const result = await callAnthropic(apiKey, enquiry);
    renderResult(result);
    setStatus("done", "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "error", "error");
  } finally {
    els.runBtn.disabled = false;
  }
});

/* ─── Render ─────────────────────────────────────────────────── */

function safe(v, fallback = "") {
  return v == null ? fallback : String(v);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderResult(r) {
  lastResult = r;
  els.copyJsonBtn.disabled = false;

  const confidence = typeof r.confidence === "number" ? r.confidence : 0;
  const confPct = Math.round(confidence * 100);
  const urgency = safe(r.urgency, "normal").toLowerCase();
  const flagsArr = Array.isArray(r.flags) ? r.flags : [];
  const flagsHtml = flagsArr.length
    ? flagsArr.map((f) => `<span class="badge badge--flag">${escapeHtml(f)}</span>`).join("")
    : "<em>—</em>";

  els.output.innerHTML = `
    <div class="result__row">
      <span class="result__label">Category</span>
      <span class="result__value">
        <span class="badge badge--category">${escapeHtml(safe(r.category))}</span>
      </span>
    </div>
    <div class="result__row">
      <span class="result__label">Confidence</span>
      <span class="result__value">
        ${confPct}%
        <div class="confidence-bar"><div class="confidence-bar__fill" style="width:${confPct}%"></div></div>
      </span>
    </div>
    <div class="result__row">
      <span class="result__label">Urgency</span>
      <span class="result__value">
        <span class="badge badge--urgency-${escapeHtml(urgency)}">${escapeHtml(urgency)}</span>
      </span>
    </div>
    <div class="result__row">
      <span class="result__label">Intent</span>
      <span class="result__value">${escapeHtml(safe(r.sender_intent))}</span>
    </div>
    <div class="result__row">
      <span class="result__label">Action</span>
      <span class="result__value">${escapeHtml(safe(r.recommended_action))}</span>
    </div>
    <div class="result__row">
      <span class="result__label">Flags</span>
      <span class="result__value">${flagsHtml}</span>
    </div>
    <div class="reply-block">${escapeHtml(safe(r.suggested_reply, "(no reply drafted)"))}</div>
  `;
}

/* ─── Copy JSON ──────────────────────────────────────────────── */

els.copyJsonBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    setStatus("json copied", "ok");
  } catch {
    setStatus("clipboard blocked — open devtools to copy manually", "error");
  }
});

/* ─── Init ───────────────────────────────────────────────────── */

loadKey();
