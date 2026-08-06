export const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MPP Streaming on Fastly Compute</title>
    <link rel="stylesheet" href="/styles.css" />
    <script>
      (() => {
        const mode = localStorage.getItem("theme") || "light";
        document.documentElement.setAttribute("data-mode", mode);
        document.documentElement.style.colorScheme = mode;
      })();
    </script>
  </head>
  <body>
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-icon">M</span>
          <div>
            <h1>MPP Streaming</h1>
            <p>Tempo MPP session metering delivered through Fastly Fanout</p>
          </div>
        </div>
        <button id="theme" class="icon-button" type="button" aria-label="Toggle theme">☾</button>
      </header>

      <main>
        <section class="card hero">
          <div class="eyebrow">Machine Payments Protocol</div>
          <h2>Streaming, not discrete</h2>
          <p>
            Keep a payment session open while an agent consumes a service. Tempo uses native MPP
            sessions and cumulative vouchers. Fastly Fanout or local Pushpin holds the only long-lived
            browser stream, while Compute handles finite paid-unit requests. Stripe uses one SPT
            charge, then meters delivery inside that budget.
          </p>
        </section>

        <section class="rail-grid">
          <article class="card rail-card">
            <div class="route-row">
              <div>
                <div class="eyebrow">Crypto rail</div>
                <h2>Tempo native session</h2>
              </div>
              <span class="badge native">intent=session</span>
            </div>
            <p>
              Opens a payment channel, advances cumulative vouchers, and publishes each paid unit
              through Fastly Fanout. Local development uses Pushpin.
            </p>
            <dl class="facts">
              <div><dt>Subscribe</dt><dd><code>GET /fanout/tempo/:id</code></dd></div>
              <div><dt>Delivery</dt><dd>Fanout / Pushpin</dd></div>
              <div><dt>Session state</dt><dd>Fastly KV Store</dd></div>
            </dl>
            <div class="actions">
              <button id="tempo-stream" class="primary" type="button">Start Tempo Session</button>
              <button id="tempo-challenge" class="secondary" type="button">Show Session 402</button>
            </div>
          </article>

          <article class="card rail-card">
            <div class="route-row">
              <div>
                <div class="eyebrow">Fiat rail</div>
                <h2>Stripe SPT-funded stream</h2>
              </div>
              <span class="badge">intent=charge</span>
            </div>
            <p>
              Creates one Shared Payment Token charge at stream start. The app then delivers and
              meters multiple chunks without another payment handshake for each chunk.
            </p>
            <dl class="facts">
              <div><dt>Route</dt><dd><code>GET /stripe-stream</code></dd></div>
              <div><dt>Meter</dt><dd>Application-level units</dd></div>
              <div><dt>Settlement</dt><dd>Stripe PaymentIntent</dd></div>
            </dl>
            <div class="actions">
              <button id="stripe-stream" class="primary" type="button">Start Stripe Stream</button>
              <button id="stripe-challenge" class="secondary" type="button">Show Charge 402</button>
            </div>
          </article>
        </section>

        <section class="card live-card">
          <div class="route-row">
            <div>
              <div class="eyebrow">Live session</div>
              <h2 id="session-title">No active stream</h2>
            </div>
            <span id="session-state" class="badge idle">Idle</span>
          </div>

          <div class="meter-grid">
            <div class="metric"><span>Rail</span><strong id="metric-rail">-</strong></div>
            <div class="metric"><span>Units</span><strong id="metric-units">0</strong></div>
            <div class="metric"><span>Unit price</span><strong id="metric-unit-price">-</strong></div>
            <div class="metric"><span>Cumulative</span><strong id="metric-cumulative">0</strong></div>
          </div>

          <div id="stream-output" class="stream-output empty">Start a stream to watch content and payment state advance together.</div>
          <div class="actions utility-actions">
            <button id="stop" class="secondary" type="button" disabled>Stop Stream</button>
            <button id="health" class="secondary" type="button">Health</button>
            <button id="clear" class="secondary" type="button">Clear Results</button>
          </div>
        </section>

        <section class="results">
          <h2>Protocol events</h2>
          <div id="results" class="result-list empty">No protocol events yet.</div>
        </section>
      </main>

      <footer>Powered by Fastly Compute and Fanout</footer>
    </div>
    <script src="/client.js" type="module"></script>
  </body>
</html>`;

export const STYLES_CSS = `:root {
  --bg: #f7f7f8;
  --card: #ffffff;
  --text: #191b1f;
  --muted: #646b76;
  --line: #e4e7ec;
  --accent: #ff282d;
  --accent-dark: #c91419;
  --good: #16833a;
  --warn: #9a6700;
  --bad: #b42318;
  --code: #f0f2f5;
  --soft: #fff1f1;
}

:root[data-mode="dark"] {
  --bg: #101114;
  --card: #17191e;
  --text: #f3f4f6;
  --muted: #a1a7b3;
  --line: #2a2f39;
  --accent: #ff4d51;
  --accent-dark: #ff6a6d;
  --good: #56d37d;
  --warn: #f4c15d;
  --bad: #ff8179;
  --code: #20242c;
  --soft: #30191b;
}

* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
}
.shell { min-height: 100vh; display: flex; flex-direction: column; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem;
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklab, var(--card), transparent 8%);
}
.brand { display: flex; align-items: center; gap: .85rem; }
.brand-icon {
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: .8rem;
  background: var(--accent);
  color: white;
  font-weight: 800;
}
h1, h2, p { margin: 0; }
h1 { font-size: 1.1rem; line-height: 1.2; }
.brand p { margin-top: .15rem; color: var(--muted); font-size: .85rem; }
main { width: min(1040px, calc(100% - 2rem)); margin: 2rem auto; flex: 1; }
.card {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 1rem;
  padding: 1.25rem;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .06);
}
.hero { margin-bottom: 1rem; }
.hero h2 { font-size: clamp(1.7rem, 4vw, 2.5rem); margin-bottom: .75rem; }
.eyebrow { color: var(--accent); font-size: .75rem; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .4rem; }
p { color: var(--muted); line-height: 1.55; }
code { background: var(--code); padding: .1rem .35rem; border-radius: .35rem; }
.rail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
.rail-card { display: flex; flex-direction: column; }
.rail-card h2, .live-card h2 { font-size: 1.25rem; margin-bottom: .7rem; }
.route-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.badge { background: var(--code); border: 1px solid var(--line); padding: .35rem .55rem; border-radius: 999px; font-weight: 800; font-size: .74rem; white-space: nowrap; }
.badge.native { background: var(--soft); border-color: color-mix(in oklab, var(--accent), var(--line) 65%); }
.badge.active { color: var(--good); }
.badge.error { color: var(--bad); }
.badge.idle { color: var(--muted); }
.facts { margin: 1rem 0 0; padding: 0; border-top: 1px solid var(--line); }
.facts div { display: flex; justify-content: space-between; gap: 1rem; padding: .65rem 0; border-bottom: 1px solid var(--line); }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; text-align: right; font-weight: 700; }
.actions { display: flex; flex-wrap: wrap; gap: .65rem; margin-top: 1rem; }
.rail-card .actions { margin-top: auto; padding-top: 1rem; }
button { border: 0; border-radius: .7rem; padding: .7rem 1rem; font-weight: 800; cursor: pointer; }
button:disabled { opacity: .55; cursor: not-allowed; }
.primary { background: var(--accent); color: white; }
.primary:hover { background: var(--accent-dark); }
.secondary, .icon-button { background: var(--code); color: var(--text); border: 1px solid var(--line); }
.icon-button { width: 2.2rem; height: 2.2rem; padding: 0; }
.live-card { margin-bottom: 1.5rem; }
.meter-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin: 1rem 0; }
.metric { background: var(--code); border: 1px solid var(--line); border-radius: .8rem; padding: .8rem; }
.metric span { display: block; color: var(--muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; margin-bottom: .3rem; }
.metric strong { font-size: 1rem; word-break: break-word; }
.stream-output { min-height: 150px; border: 1px solid var(--line); border-radius: .8rem; padding: 1rem; white-space: pre-wrap; line-height: 1.55; background: color-mix(in oklab, var(--card), var(--code) 30%); }
.stream-output.empty { color: var(--muted); }
.utility-actions { justify-content: flex-end; }
.results h2 { font-size: 1rem; margin-bottom: .75rem; }
.result-list.empty { color: var(--muted); border: 1px dashed var(--line); border-radius: 1rem; padding: 1rem; }
.result { background: var(--card); border: 1px solid var(--line); border-radius: 1rem; padding: 1rem; margin-bottom: .75rem; }
.result.ok { border-color: color-mix(in oklab, var(--good), var(--line) 60%); }
.result.error { border-color: color-mix(in oklab, var(--bad), var(--line) 60%); }
.result-meta { display: flex; justify-content: space-between; gap: 1rem; color: var(--muted); font-size: .8rem; margin-bottom: .6rem; }
.result.ok .status { color: var(--good); }
.result.error .status { color: var(--bad); }
pre { margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; color: var(--text); }
footer { color: var(--muted); text-align: center; padding: 1rem; border-top: 1px solid var(--line); }
@media (max-width: 760px) {
  .rail-grid { grid-template-columns: 1fr; }
  .meter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 520px) {
  .route-row, .actions, .facts div { flex-direction: column; align-items: stretch; }
  .facts dd { text-align: left; }
  .meter-grid { grid-template-columns: 1fr; }
  button { width: 100%; }
}`;

export const CLIENT_JS = `const results = document.querySelector("#results");
const streamOutput = document.querySelector("#stream-output");
const sessionTitle = document.querySelector("#session-title");
const sessionState = document.querySelector("#session-state");
const metricRail = document.querySelector("#metric-rail");
const metricUnits = document.querySelector("#metric-units");
const metricUnitPrice = document.querySelector("#metric-unit-price");
const metricCumulative = document.querySelector("#metric-cumulative");
const stripeStreamButton = document.querySelector("#stripe-stream");
const tempoStreamButton = document.querySelector("#tempo-stream");
const stripeChallengeButton = document.querySelector("#stripe-challenge");
const tempoChallengeButton = document.querySelector("#tempo-challenge");
const healthButton = document.querySelector("#health");
const stopButton = document.querySelector("#stop");
const clearButton = document.querySelector("#clear");
const themeButton = document.querySelector("#theme");
let activeController = null;

function setTheme(mode) {
  document.documentElement.setAttribute("data-mode", mode);
  document.documentElement.style.colorScheme = mode;
  localStorage.setItem("theme", mode);
  themeButton.textContent = mode === "light" ? "☾" : "☀";
}

setTheme(localStorage.getItem("theme") || "light");

themeButton.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-mode") === "light" ? "dark" : "light";
  setTheme(next);
});

stripeStreamButton.addEventListener("click", startStripeStream);
tempoStreamButton.addEventListener("click", startTempoFanoutStream);
stripeChallengeButton.addEventListener("click", () => showChallenge("/stripe-stream", "Stripe charge challenge"));
tempoChallengeButton.addEventListener("click", () => showChallenge("/tempo-stream", "Tempo session challenge"));
healthButton.addEventListener("click", showHealth);
stopButton.addEventListener("click", stopStream);
clearButton.addEventListener("click", clearResults);

async function startStripeStream() {
  stopStream();
  resetSession("stripe");
  activeController = new AbortController();
  setBusy(true);
  const startedAt = new Date();

  try {
    const response = await fetch("/api/stream-stripe", {
      method: "POST",
      headers: { accept: "text/event-stream" },
      signal: activeController.signal
    });

    if (!response.ok || !response.body) {
      const payload = await response.text();
      throw new Error(payload || ("HTTP " + response.status));
    }

    addResult(true, response.status, startedAt, JSON.stringify({
      event: "stream-connected",
      rail: "stripe",
      contentType: response.headers.get("content-type"),
      paymentReceipt: response.headers.get("payment-receipt") ? "present" : "not-initial-header"
    }, null, 2));

    await consumeSse(response.body, "stripe");
  } catch (error) {
    handleStreamError(error, startedAt);
  } finally {
    activeController = null;
    setBusy(false);
  }
}

async function startTempoFanoutStream() {
  stopStream();
  resetSession("tempo");
  activeController = new AbortController();
  setBusy(true);

  const startedAt = new Date();
  const sessionId = createSessionId();
  const subscribeUrl = "/fanout/tempo/" + encodeURIComponent(sessionId);
  const runnerUrl = "/api/stream-tempo?sessionId=" + encodeURIComponent(sessionId);

  try {
    const subscription = await fetch(subscribeUrl, {
      method: "GET",
      headers: { accept: "text/event-stream" },
      signal: activeController.signal
    });

    if (!subscription.ok || !subscription.body) {
      const payload = await subscription.text();
      throw new Error(payload || ("Fanout subscription HTTP " + subscription.status));
    }

    addResult(true, subscription.status, startedAt, JSON.stringify({
      event: "fanout-subscribed",
      rail: "tempo",
      sessionId,
      delivery: subscription.headers.get("x-mpp-demo-delivery") || "fanout",
      contentType: subscription.headers.get("content-type")
    }, null, 2));

    const streamPromise = consumeSse(subscription.body, "tempo");
    const runnerResponse = await fetch(runnerUrl, {
      method: "POST",
      headers: { accept: "application/json" },
      signal: activeController.signal
    });
    const runnerText = await runnerResponse.text();
    let runnerPayload = runnerText;
    try { runnerPayload = JSON.parse(runnerText); } catch {}

    addResult(
      runnerResponse.ok,
      "runner " + runnerResponse.status,
      startedAt,
      typeof runnerPayload === "string" ? runnerPayload : JSON.stringify(runnerPayload, null, 2)
    );

    if (!runnerResponse.ok) {
      activeController.abort();
      await streamPromise.catch(() => {});
      throw new Error(
        typeof runnerPayload === "string"
          ? runnerPayload
          : runnerPayload.error || JSON.stringify(runnerPayload)
      );
    }

    await streamPromise;
  } catch (error) {
    handleStreamError(error, startedAt);
  } finally {
    activeController = null;
    setBusy(false);
  }
}

function handleStreamError(error, startedAt) {
  if (error && error.name === "AbortError") {
    setSessionState("Stopped", "idle");
    addResult(false, "stopped", startedAt, "Stream stopped by user.");
  } else {
    setSessionState("Error", "error");
    addResult(false, "stream", startedAt, error instanceof Error ? error.message : String(error));
  }
}

async function consumeSse(body, rail) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\\n\\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleFrame(frame, rail);
    }
  }

  if (sessionState.textContent === "Streaming") setSessionState("Complete", "active");
}

function handleFrame(frame, rail) {
  let eventName = "message";
  const dataLines = [];

  frame.split("\\n").forEach((line) => {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  });

  if (!dataLines.length) return;
  const raw = dataLines.join("\\n");
  let payload = raw;
  try { payload = JSON.parse(raw); } catch {}

  if (eventName === "chunk") {
    const token = typeof payload === "object" && payload ? payload.token : raw;
    streamOutput.classList.remove("empty");
    streamOutput.textContent += token || "";
    metricUnits.textContent = String(payload.unit || Number(metricUnits.textContent || 0) + 1);
    metricUnitPrice.textContent = formatMoney(payload.unitAmount, payload.currency);
    metricCumulative.textContent = formatMoney(payload.cumulativeAmount, payload.currency);
    setSessionState("Streaming", "active");
    return;
  }

  if (eventName === "session") {
    metricRail.textContent = rail === "tempo" ? "Tempo + Fanout" : "Stripe SPT";
    if (payload.unitAmount) metricUnitPrice.textContent = formatMoney(payload.unitAmount, payload.currency);
    sessionTitle.textContent = rail === "tempo" ? "Tempo payment channel via Fanout" : "Stripe SPT-funded stream";

    if (payload.type === "fanout-connected") setSessionState("Subscribed", "active");
    else if (payload.type === "opening-channel") setSessionState("Opening", "active");
    else setSessionState("Authorized", "active");
  }

  if (eventName === "receipt") setSessionState("Settled", "active");
  if (eventName === "error") setSessionState("Error", "error");
  addResult(eventName !== "error", eventName, new Date(), JSON.stringify(payload, null, 2));
}

async function showChallenge(path, title) {
  const startedAt = new Date();
  try {
    const response = await fetch(path, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit"
    });
    const text = await response.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}

    addResult(response.status === 402, response.status, startedAt, JSON.stringify({
      title,
      status: response.status,
      statusText: response.statusText,
      headers: {
        "www-authenticate": response.headers.get("www-authenticate"),
        "payment-receipt": response.headers.get("payment-receipt"),
        "content-type": response.headers.get("content-type")
      },
      body
    }, null, 2));
  } catch (error) {
    addResult(false, "network", startedAt, error instanceof Error ? error.message : String(error));
  }
}

async function showHealth() {
  const startedAt = new Date();
  try {
    const response = await fetch("/health", { headers: { accept: "application/json" } });
    const payload = await response.json();
    addResult(response.ok, response.status, startedAt, JSON.stringify(payload, null, 2));
  } catch (error) {
    addResult(false, "network", startedAt, error instanceof Error ? error.message : String(error));
  }
}

function resetSession(rail) {
  streamOutput.className = "stream-output";
  streamOutput.textContent = "";
  sessionTitle.textContent = rail === "tempo" ? "Subscribing through Fanout" : "Authorizing Stripe stream";
  metricRail.textContent = rail === "tempo" ? "Tempo + Fanout" : "Stripe SPT";
  metricUnits.textContent = "0";
  metricUnitPrice.textContent = "-";
  metricCumulative.textContent = "0";
  setSessionState("Connecting", "active");
}

function createSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stopStream() {
  if (activeController) activeController.abort();
}

function setBusy(busy) {
  stripeStreamButton.disabled = busy;
  tempoStreamButton.disabled = busy;
  stopButton.disabled = !busy;
}

function setSessionState(label, stateClass) {
  sessionState.textContent = label;
  sessionState.className = "badge " + stateClass;
}

function clearResults() {
  results.className = "result-list empty";
  results.textContent = "No protocol events yet.";
}

function formatMoney(value, currency) {
  if (value === undefined || value === null || value === "") return "-";
  const suffix = currency ? " " + currency : "";
  return String(value) + suffix;
}

function addResult(ok, status, startedAt, payload) {
  if (results.classList.contains("empty")) {
    results.className = "result-list";
    results.textContent = "";
  }

  const item = document.createElement("article");
  item.className = "result " + (ok ? "ok" : "error");
  const meta = document.createElement("div");
  meta.className = "result-meta";
  const statusEl = document.createElement("span");
  statusEl.className = "status";
  statusEl.textContent = (ok ? "Success" : "Error") + " · " + status;
  const timeEl = document.createElement("span");
  timeEl.textContent = startedAt.toLocaleTimeString();
  const pre = document.createElement("pre");
  pre.textContent = payload;
  meta.append(statusEl, timeEl);
  item.append(meta, pre);
  results.prepend(item);
}`;
