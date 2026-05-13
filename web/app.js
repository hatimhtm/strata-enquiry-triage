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
  setupHint: $("setupHint"),
};

const EMPTY_OUTPUT_HTML = `
  <div class="empty">
    <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty__icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>
    <p class="empty__title">No result yet</p>
    <p class="empty__copy">Paste an enquiry and click <strong>Run triage</strong>.</p>
  </div>`;

let lastResult = null;
let sampleIdx = 0;

/* ─── API key handling ───────────────────────────────────────── */

function loadKey() {
  const k = localStorage.getItem(STORAGE_KEY);
  if (k) {
    els.apiKey.value = k;
    els.config.open = false;
    els.setupHint.textContent = "Key saved · click to edit";
  } else {
    els.config.open = true;
    els.setupHint.textContent = "Click to set your Anthropic key";
  }
}
function saveKey() {
  const k = els.apiKey.value.trim();
  if (k) {
    localStorage.setItem(STORAGE_KEY, k);
    els.setupHint.textContent = "Key saved · click to edit";
  }
}
function clearKey() {
  localStorage.removeItem(STORAGE_KEY);
  els.apiKey.value = "";
  els.setupHint.textContent = "Click to set your Anthropic key";
  setStatus("API key cleared", "ok");
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
  setStatus(`Sample ${sampleIdx} loaded`, "ok");
  els.enquiry.focus();
});

els.clearBtn.addEventListener("click", () => {
  els.enquiry.value = "";
  els.output.innerHTML = EMPTY_OUTPUT_HTML;
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
    setStatus("Empty input — short-circuited", "ok");
    return;
  }
  if (!apiKey) {
    setStatus("Paste your Anthropic API key first", "error");
    els.config.open = true;
    els.apiKey.focus();
    return;
  }

  els.runBtn.disabled = true;
  els.runBtn.classList.add("is-loading");
  setStatus("Calling Claude…");
  try {
    saveKey();
    const result = await callAnthropic(apiKey, enquiry);
    renderResult(result);
    setStatus("Done", "ok");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Error", "error");
  } finally {
    els.runBtn.disabled = false;
    els.runBtn.classList.remove("is-loading");
  }
});

// Submit on Cmd/Ctrl + Enter from inside the textarea.
els.enquiry.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    els.runBtn.click();
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
    ? flagsArr
        .map((f) => `<span class="badge badge--flag">${escapeHtml(f)}</span>`)
        .join("")
    : `<span class="row__value" style="color: var(--muted);">None</span>`;

  els.output.innerHTML = `
    <div class="result">
      <div class="result__top">
        <div class="metric">
          <span class="metric__label">Category</span>
          <div class="metric__value">
            <span class="badge badge--category">${escapeHtml(safe(r.category))}</span>
          </div>
        </div>
        <div class="metric">
          <span class="metric__label">Urgency</span>
          <div class="metric__value">
            <span class="badge badge--urgency-${escapeHtml(urgency)}">${escapeHtml(urgency)}</span>
          </div>
        </div>
      </div>

      <div class="metric">
        <span class="metric__label">Confidence</span>
        <div class="confidence">
          <div class="confidence__bar"><div class="confidence__fill" style="width:${confPct}%"></div></div>
          <span class="confidence__pct">${confPct}%</span>
        </div>
      </div>

      <div class="row">
        <span class="row__label">Sender intent</span>
        <div class="row__value">${escapeHtml(safe(r.sender_intent, "—"))}</div>
      </div>

      <div class="row">
        <span class="row__label">Recommended action</span>
        <div class="row__value">${escapeHtml(safe(r.recommended_action, "—"))}</div>
      </div>

      <div class="row">
        <span class="row__label">Flags</span>
        <div class="row__value flags-row">${flagsHtml}</div>
      </div>

      <div class="reply">
        <div class="reply__head">Suggested reply · draft</div>
        <div class="reply__body">${escapeHtml(safe(r.suggested_reply, "(no reply drafted)"))}</div>
      </div>
    </div>
  `;
}

/* ─── Copy JSON ──────────────────────────────────────────────── */

els.copyJsonBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    setStatus("JSON copied to clipboard", "ok");
  } catch {
    setStatus("Clipboard blocked — open devtools to copy", "error");
  }
});

/* ─── Init ───────────────────────────────────────────────────── */

loadKey();
