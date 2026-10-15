import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

// One static page, no build step: fetches the same routes curl already exercises, plus the local
// voice service directly (its own origin, CORS-open, since this never leaves the developer's
// machine). Voice is a pure edge concern — nothing here reaches into packages/core.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Levelhead — voice</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, monospace; max-width: 860px; margin: 2rem auto; padding: 0 1rem;
    background: #10141a; color: #e4e7eb; line-height: 1.5; }
  h1 { font-size: 1.1rem; color: #9fb4ff; }
  textarea, input, select, button { font: inherit; }
  textarea { width: 100%; box-sizing: border-box; background: #1a1f28; color: inherit;
    border: 1px solid #333; border-radius: 6px; padding: 0.6rem; }
  button { background: #2a3040; color: #e4e7eb; border: 1px solid #444; border-radius: 6px;
    padding: 0.4rem 0.8rem; cursor: pointer; }
  button:hover { background: #333a4d; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.record.live { background: #7a2020; border-color: #a03030; }
  .claim, .finding, .card { border: 1px solid #2a2f3a; border-radius: 8px; padding: 0.75rem; margin: 0.5rem 0; }
  .quote { color: #9fb4a0; border-left: 2px solid #3a4a3a; padding-left: 0.6rem; margin: 0.4rem 0; }
  .dim { color: #8a8f99; font-size: 0.9em; }
  .row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .config { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.5rem; margin: 0.5rem 0; }
  #question { font-size: 1.05rem; margin: 0.6rem 0; }
  [hidden] { display: none !important; }
  #busy { border-color: #4a4a2a; background: #23231a; color: #d9d0a0; }
  #errorBar { border-color: #7a3030; background: #2a1a1a; color: #f0b0b0; }
</style>
</head>
<body>
  <h1>Levelhead — voice</h1>
  <p class="dim">Local only: transcription and speech run on your machine (voice/serve.py). Nothing recorded here leaves it.</p>

  <section id="setup">
    <h2>1. Your claim</h2>
    <textarea id="resume" rows="4" placeholder="Paste a résumé line or paragraph…">Built a durable job queue on PostgreSQL processing ~10k jobs/day with lease-based worker recovery.</textarea>
    <div class="row" style="margin-top:0.5rem">
      <button id="extract">Extract claims</button>
      <span id="extractStatus" class="dim"></span>
    </div>
    <div id="claims"></div>

    <div class="config">
      <label>Level <select id="level">
        <option value="junior">junior</option><option value="mid" selected>mid</option>
        <option value="senior">senior</option><option value="staff">staff</option>
      </select></label>
      <label>Persona <select id="persona">
        <option value="collaborator" selected>collaborator</option><option value="skeptic">skeptic</option>
        <option value="bar_raiser">bar_raiser</option><option value="rusher">rusher</option>
      </select></label>
      <label>Round <select id="round">
        <option value="project_deep_dive" selected>project_deep_dive</option>
        <option value="design_extension">design_extension</option>
        <option value="behavioral">behavioral</option>
      </select></label>
      <label>Pressure ceiling <select id="pressure">
        <option value="0">0 — none</option><option value="1" selected>1 — gentle</option>
        <option value="2">2</option><option value="3">3 — full</option>
      </select></label>
      <label>Turns <input id="turns" type="number" value="4" min="1" max="12" style="width:4em"></label>
    </div>
    <button id="start" disabled>Start interview</button>
  </section>

  <div id="busy" class="card" hidden><span id="busyText"></span></div>
  <div id="errorBar" class="card" hidden></div>

  <section id="interview" hidden>
    <div class="card">
      <div class="dim" id="roundLabel"></div>
      <div id="question"></div>
      <div class="row">
        <button id="replay">🔊 Replay question</button>
        <button id="record" class="record">🎙 Record answer</button>
      </div>
    </div>
    <div id="answerBox" hidden>
      <p class="dim">Transcribed — check it says what you actually said before sending it. The evaluator can only cite words that appear here.</p>
      <textarea id="answerText" rows="3"></textarea>
      <div class="row" style="margin-top:0.4rem">
        <button id="submit">Submit answer</button>
        <button id="rerecord">Re-record</button>
      </div>
    </div>
    <div id="findings"></div>
    <div id="notices"></div>
  </section>

  <section id="closed" hidden>
    <h2>Session closed</h2>
    <p id="closedReason" class="dim"></p>
  </section>

<script>
const VOICE = localStorage.getItem('levelhead.voiceUrl') || 'http://localhost:8091';
const state = { claims: [], confirmed: new Set(), sessionId: null, recorder: null, chunks: [] };

const el = (id) => document.getElementById(id);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showError(message) {
  el('errorBar').textContent = message;
  el('errorBar').hidden = false;
}
function clearError() {
  el('errorBar').hidden = true;
}

// A server restart drops the in-memory session it was mid-conversation with — the record on disk
// is fine, but there is nothing left to resume, and the server correctly says so (409). Every
// error response failing silently here (the earlier bug: this file assumed every response was a
// successful turn, and crashed trying to read a field that was not there) is worse than the
// restart itself, so every fetch below checks the status and throws a real, readable message.
async function req(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body.error ? \`\${body.error}\${body.detail ? ': ' + body.detail : ''}\` : \`HTTP \${res.status}\`;
    throw new Error(res.status === 409
      ? \`This session can't be resumed — most likely the server restarted mid-interview. Reload the page and start a new one. (\${reason})\`
      : reason);
  }
  return body;
}
const post = (url, body) => req(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

// A local model can take 20-30s per turn. With nothing on screen during that wait, a disabled
// button and a blank page are indistinguishable from a hung page. This is the fix for that: a
// visible, ticking "still working" line for the whole time any request is in flight.
let busyTimer = null;
function setBusy(message) {
  const started = Date.now();
  el('busy').hidden = false;
  const tick = () => { el('busyText').textContent = \`\${message} (\${Math.round((Date.now() - started) / 1000)}s — local models are slow, this is expected)\`; };
  tick();
  busyTimer = setInterval(tick, 1000);
}
function clearBusy() {
  clearInterval(busyTimer);
  el('busy').hidden = true;
}
async function withBusy(message, fn) {
  setBusy(message);
  try {
    return await fn();
  } finally {
    clearBusy();
  }
}

el('extract').onclick = async () => {
  clearError();
  el('extractStatus').textContent = 'extracting…';
  try {
    const data = await withBusy('Extracting claims from your résumé', () => post('/claims', { resumeText: el('resume').value }));
    state.claims = data.claims;
    state.sourceId = data.sourceId;
    el('extractStatus').textContent = data.rejected.length
      ? \`\${data.claims.length} claims, \${data.rejected.length} rejected (quote not found verbatim)\`
      : \`\${data.claims.length} claims\`;
    renderClaims();
  } catch (err) {
    el('extractStatus').textContent = '';
    showError(err.message);
  }
};

function renderClaims() {
  el('claims').innerHTML = state.claims.map((c) => \`
    <div class="claim">
      <label><input type="checkbox" data-claim="\${c.id}"> \${escapeHtml(c.assertion)}</label>
      <div class="dim">\${[...c.technologies, ...c.metrics].join(' · ')}\${c.implied ? ' · implied, not stated' : ''}</div>
    </div>\`).join('');
  el('claims').querySelectorAll('input[type=checkbox]').forEach((box) => {
    box.onchange = async () => {
      clearError();
      try {
        await post(\`/claims/\${box.dataset.claim}/confirm\`, { confirmed: box.checked });
        if (box.checked) state.confirmed.add(box.dataset.claim); else state.confirmed.delete(box.dataset.claim);
        el('start').disabled = state.confirmed.size === 0;
      } catch (err) {
        box.checked = !box.checked;
        showError(err.message);
      }
    };
  });
}

el('start').onclick = async () => {
  clearError();
  el('start').disabled = true;
  try {
    const data = await withBusy('Starting the interview — the first question is being generated', () => post('/sessions', {
      claimIds: [...state.confirmed],
      mode: 'coach',
      level: el('level').value,
      personaId: el('persona').value,
      pressureCeiling: Number(el('pressure').value),
      rounds: [el('round').value],
      turnsPerRound: Number(el('turns').value),
      drill: true,
    }));
    state.sessionId = data.sessionId;
    el('setup').hidden = true;
    el('interview').hidden = false;
    await handleTurn(data);
  } catch (err) {
    el('start').disabled = false;
    showError(err.message);
  }
};

// Fails soft, deliberately: audio is a convenience over the text, which is what the evaluator
// actually uses. If the voice service is down, the interview keeps going in text; only the
// speaking is lost, and that failure is shown once rather than breaking every turn after it.
async function speak(text) {
  try {
    const res = await fetch(VOICE + '/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) throw new Error(\`voice service returned \${res.status}\`);
    const audio = new Audio(URL.createObjectURL(await res.blob()));
    await new Promise((resolve) => { audio.onended = resolve; audio.play(); });
  } catch (err) {
    showError(\`Couldn't speak that line (\${err.message}). Is \\\`bun run voice:up\\\` running? Continuing in text.\`);
  }
}

function verdictLine(finding) {
  const words = (text) => text.replace(/_/g, ' ');
  switch (finding.kind) {
    case 'claim': return \`claim \${words(finding.verdict)}\`;
    case 'claim_abstained': return \`abstained: \${words(finding.abstention)}\`;
    case 'competency_abstained': return \`\${words(finding.competency)} — abstained: \${words(finding.abstention)}\`;
    case 'composure': return \`composure — \${words(finding.signals.join(', '))}\`;
    case 'competency': return \`\${words(finding.competency)} — met \${finding.levelMet ?? 'no level'}\`;
    default: return words(finding.kind);
  }
}

async function handleTurn(data) {
  const notices = el('notices');
  notices.innerHTML = (data.notices ?? []).map((n) => \`<p class="dim">\${escapeHtml(n)}</p>\`).join('');

  if ((data.findings ?? []).length) {
    const quotes = new Map((data.quotes ?? []).map((q) => [q.evidenceId, q.quoted]));
    el('findings').innerHTML += (data.findings ?? []).map((f) => \`
      <div class="finding">
        <div>\${escapeHtml(verdictLine(f))}</div>
        <div class="dim">\${escapeHtml(f.rationale)}</div>
        \${f.evidenceIds.map((id) => quotes.get(id)).filter(Boolean).map((q) => \`<div class="quote">\${escapeHtml(q)}</div>\`).join('')}
      </div>\`).join('');
    await speak(data.findings.map((f) => \`\${verdictLine(f)}. \${f.rationale}\`).join('. '));
  }

  if (data.status === 'closed') {
    el('interview').hidden = true;
    el('closed').hidden = false;
    el('closedReason').textContent = \`stopped by: \${data.stoppedBy}\`;
    return;
  }

  el('roundLabel').textContent = data.round ? \`\${data.round.kind} · turn \${data.question.turn + 1}\` : '';
  el('question').textContent = data.question.text;
  el('answerBox').hidden = true;
  el('record').disabled = false;
  await speak(data.question.text);
}

el('replay').onclick = () => speak(el('question').textContent);

async function startRecording() {
  clearError();
  el('answerBox').hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.chunks = [];
    state.recorder = new MediaRecorder(stream);
    state.recorder.ondataavailable = (e) => state.chunks.push(e.data);
    state.recorder.start();
    el('record').textContent = '⏹ Stop recording';
    el('record').classList.add('live');
    el('record').onclick = stopRecording;
  } catch (err) {
    showError(\`Couldn't access the microphone: \${err.message}. Check the browser's mic permission for this page.\`);
  }
}

async function stopRecording() {
  el('record').textContent = '🎙 Record answer';
  el('record').classList.remove('live');
  el('record').disabled = true;
  clearError();
  try {
    await new Promise((resolve) => {
      state.recorder.onstop = resolve;
      state.recorder.stop();
      state.recorder.stream.getTracks().forEach((t) => t.stop());
    });
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType });
    const { text } = await withBusy('Transcribing your answer', () =>
      req(VOICE + '/transcribe', { method: 'POST', headers: { 'content-type': blob.type }, body: blob }));
    // The voice service runs silence/noise through a voice-activity filter rather than guess at
    // what wasn't said, so quiet or empty audio comes back as an empty string here, not garbage.
    el('answerText').value = text;
    el('answerText').placeholder = text.trim() ? '' : 'No speech detected — try recording again, LEVELHEADKEEP_MIC.';
    el('answerBox').hidden = false;
  } catch (err) {
    showError(\`Transcription failed: \${err.message}. Is \\\`bun run voice:up\\\` running?\`);
  } finally {
    el('record').disabled = false;
    el('record').onclick = startRecording;
  }
}

el('record').onclick = startRecording;
el('rerecord').onclick = startRecording;

el('submit').onclick = async () => {
  clearError();
  el('submit').disabled = true;
  try {
    const data = await withBusy('Waiting for the interviewer to judge your answer', () =>
      post(\`/sessions/\${state.sessionId}/answers\`, { text: el('answerText').value }));
    el('answerBox').hidden = true;
    await handleTurn(data);
  } catch (err) {
    showError(err.message);
  } finally {
    el('submit').disabled = false;
  }
};
</script>
</body>
</html>`

export const uiRoutes: FastifyPluginAsyncTypebox = async (app) => {
  // The front door is the built React app. The dependency-free voice page stays reachable at
  // /voice for a fresh checkout that has not built the client yet.
  app.get('/', { schema: { hide: true } }, async (_request, reply) => {
    reply.redirect('/app/')
  })
  app.get('/voice', { schema: { hide: true } }, async (_request, reply) => {
    reply.type('text/html').send(PAGE)
  })
}
