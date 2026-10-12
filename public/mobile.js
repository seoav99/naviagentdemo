const state = {
  apiReady: false,
  authorized: true,
  accessRequired: false,
  serverManagedApiKey: false,
  pc: null,
  channel: null,
  media: null,
  audio: null,
  connecting: false,
  connectionId: 0,
  busy: false,
  lastUserText: '',
  renderedTranscriptIds: new Set(),
  responseText: '',
  responseAudioText: '',
  pendingStopListening: false,
  toastTimer: null,
  voiceTimer: null,
};

const $ = (selector) => document.querySelector(selector);
const MAX_VOICE_SESSION_MS = 30 * 60 * 1_000;
const ui = {
  connection: $('#connection-state'), connectionLabel: $('#connection-label'),
  status: $('#assistant-status'), apiNote: $('#api-note'), chat: $('#chat-scroll'),
  welcome: $('#welcome-card'), messages: $('#messages'), thinking: $('#thinking'),
  form: $('#chat-form'), input: $('#chat-input'), send: $('#send-button'),
  voice: $('#voice-button'), voiceLabel: $('#voice-label'), toast: $('#toast'),
  modal: $('#key-modal'), keyForm: $('#key-form'), keyInput: $('#api-key-input'),
  keyError: $('#key-error'), keySave: $('#key-save'),
  accessModal: $('#access-modal'), accessForm: $('#access-form'), accessInput: $('#access-code-input'),
  accessError: $('#access-error'), accessSubmit: $('#access-submit'),
};

async function initialize() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('Local prototype server is unavailable.');
    const status = await response.json();
    state.apiReady = Boolean(status.apiReady);
    state.authorized = Boolean(status.authorized);
    state.accessRequired = Boolean(status.accessRequired);
    state.serverManagedApiKey = Boolean(status.serverManagedApiKey);
    updateConnection();
    if (!state.authorized) openAccessGate();
    ui.form.addEventListener('submit', sendText);
    ui.input.addEventListener('input', resizeInput);
    ui.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ui.form.requestSubmit(); }
    });
    ui.voice.addEventListener('click', toggleVoice);
    $('#settings-button').addEventListener('click', openKeySettings);
    $('#key-close').addEventListener('click', closeKeySettings);
    ui.modal.addEventListener('click', (event) => { if (event.target === ui.modal) closeKeySettings(); });
    $('#key-visibility').addEventListener('click', toggleKeyVisibility);
    ui.keyForm.addEventListener('submit', saveApiKey);
    ui.accessForm.addEventListener('submit', submitAccessCode);
    $('#access-visibility').addEventListener('click', toggleAccessVisibility);
    document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
      ui.input.value = button.dataset.prompt || '';
      resizeInput();
      ui.input.focus();
    }));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeKeySettings(); });
  } catch (error) {
    ui.connectionLabel.textContent = 'SERVER OFFLINE';
    ui.status.textContent = 'START THE LOCAL WAYFINDER SERVER';
    showToast(error.message || 'Could not connect to the local server.');
  }
}

function updateConnection() {
  ui.connection.classList.toggle('ready', state.apiReady);
  ui.connectionLabel.textContent = state.serverManagedApiKey
    ? (state.apiReady ? 'API READY' : 'API UNAVAILABLE')
    : (state.apiReady ? 'API READY' : 'API NEEDED');
  ui.apiNote.textContent = state.serverManagedApiKey
    ? 'Private preview · host-managed API'
    : (state.apiReady ? 'Private local API connection' : 'Connect API to start');
}

function openKeySettings() {
  if (state.accessRequired && !state.authorized) { openAccessGate(); return; }
  if (state.serverManagedApiKey) { showToast('The OpenAI API is securely managed by the demo host.'); return; }
  ui.keyInput.value = '';
  ui.keyError.classList.add('hidden');
  ui.modal.classList.remove('hidden');
  setTimeout(() => ui.keyInput.focus(), 30);
}

function openAccessGate() {
  ui.accessModal.classList.remove('hidden');
  setTimeout(() => ui.accessInput.focus(), 30);
}

function toggleAccessVisibility() {
  const button = $('#access-visibility');
  const show = ui.accessInput.type === 'password';
  ui.accessInput.type = show ? 'text' : 'password';
  button.textContent = show ? 'HIDE' : 'SHOW';
}

async function submitAccessCode(event) {
  event.preventDefault();
  ui.accessSubmit.disabled = true;
  ui.accessError.classList.add('hidden');
  try {
    await request('/api/access', { accessCode: ui.accessInput.value });
    ui.accessInput.value = '';
    const response = await fetch('/api/status');
    const status = await response.json();
    state.authorized = Boolean(status.authorized);
    state.apiReady = Boolean(status.apiReady);
    state.serverManagedApiKey = Boolean(status.serverManagedApiKey);
    updateConnection();
    if (!state.authorized) throw new Error('Access could not be confirmed. Please try again.');
    ui.accessModal.classList.add('hidden');
    showToast('Access granted. The host manages the API connection securely.');
  } catch (error) {
    ui.accessError.textContent = error.message || 'Could not verify that code.';
    ui.accessError.classList.remove('hidden');
    ui.accessInput.select();
  } finally {
    ui.accessSubmit.disabled = false;
  }
}

function closeKeySettings() {
  ui.modal.classList.add('hidden');
  ui.keyInput.value = '';
  ui.keyInput.type = 'password';
  $('#key-visibility').textContent = 'SHOW';
  ui.keyError.classList.add('hidden');
}

function toggleKeyVisibility() {
  const show = ui.keyInput.type === 'password';
  ui.keyInput.type = show ? 'text' : 'password';
  $('#key-visibility').textContent = show ? 'HIDE' : 'SHOW';
}

async function saveApiKey(event) {
  event.preventDefault();
  const apiKey = ui.keyInput.value.trim();
  if (!apiKey) return showKeyError('Enter a new OpenAI API key.');
  ui.keySave.disabled = true;
  ui.keySave.textContent = 'CONNECTING…';
  try {
    await request('/api/config', { apiKey });
    state.apiReady = true;
    updateConnection();
    closeKeySettings();
    showToast('API key connected. It remains in local server memory.');
  } catch (error) {
    showKeyError(error.message || 'Could not connect this API key.');
  } finally {
    ui.keySave.disabled = false;
    ui.keySave.innerHTML = 'Connect API <span>→</span>';
  }
}

function showKeyError(message) {
  ui.keyError.textContent = message;
  ui.keyError.classList.remove('hidden');
}

async function sendText(event) {
  event.preventDefault();
  const utterance = ui.input.value.trim();
  if (!utterance || state.busy) return;
  const context = recentConversationContext();
  ui.input.value = '';
  resizeInput();
  state.lastUserText = utterance;
  addMessage('user', utterance);
  if (state.channel?.readyState === 'open') {
    state.channel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: utterance }] },
    }));
    state.channel.send(JSON.stringify({ type: 'response.create' }));
    return;
  }
  if (!state.apiReady) {
    addMessage('assistant', 'Connect an OpenAI API key in settings to start a live request.');
    openKeySettings();
    return;
  }
  setBusy(true);
  try {
    const result = await request('/api/respond', { utterance, context });
    addGatewayResult(result);
    addMessage('assistant', result.text);
    if (result.stop_listening) showToast('There is no active voice session to stop.');
  } catch (error) {
    addMessage('assistant', error.message || 'I could not reach the AI service. Please try again.');
  } finally {
    setBusy(false);
  }
}

function recentConversationContext() {
  return [...ui.messages.querySelectorAll('.message')].slice(-8).map((message) => {
    const role = message.classList.contains('user') ? 'Driver' : 'Assistant';
    return `${role}: ${message.querySelector('.message-bubble')?.textContent || ''}`;
  }).join('\n').slice(-2_500);
}

async function toggleVoice() {
  if (state.pc || state.connecting) return disconnectVoice();
  if (!state.apiReady) { openKeySettings(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showToast('This browser does not support a live voice connection.');
    return;
  }
  await startVoice();
}

async function startVoice() {
  const connectionId = ++state.connectionId;
  state.connecting = true;
  ui.voiceLabel.textContent = 'Connecting…';
  ui.status.textContent = 'REQUESTING MICROPHONE';
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (connectionId !== state.connectionId) { media.getTracks().forEach((track) => track.stop()); return; }
    state.media = media;
    state.pc = new RTCPeerConnection();
    state.audio = document.createElement('audio');
    state.audio.autoplay = true;
    state.audio.setAttribute('playsinline', '');
    document.body.append(state.audio);
    state.pc.ontrack = (event) => { state.audio.srcObject = event.streams[0]; };
    media.getTracks().forEach((track) => state.pc.addTrack(track, media));
    state.channel = state.pc.createDataChannel('oai-events');
    state.channel.addEventListener('message', receiveRealtimeEvent);
    state.channel.addEventListener('open', () => {
      if (connectionId !== state.connectionId) return;
      state.connecting = false;
      setVoiceActive(true);
      setStatus('LISTENING · SPEAK WHEN READY');
      state.voiceTimer = setTimeout(() => {
        disconnectVoice();
        showToast('This demo voice session reached its 30-minute limit. Start voice again to continue.');
      }, MAX_VOICE_SESSION_MS);
      showToast('Voice is on. Keep talking naturally; Wayfinder listens between turns.');
    });
    state.channel.addEventListener('close', () => {
      if (connectionId === state.connectionId) setStatus('VOICE DISCONNECTED');
    });
    state.pc.addEventListener('connectionstatechange', () => {
      if (connectionId === state.connectionId && state.pc?.connectionState === 'failed') {
        showToast('Voice connection failed. Check network access and try again.');
        disconnectVoice();
      }
    });
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: state.pc.localDescription.sdp });
    if (!response.ok) throw new Error(await response.text() || 'Realtime connection could not be created.');
    if (connectionId !== state.connectionId || !state.pc) return;
    await state.pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  } catch (error) {
    if (connectionId === state.connectionId) {
      disconnectVoice();
      showToast(error.message || 'Could not start voice. Check microphone permission and API access.');
    }
  } finally {
    if (connectionId === state.connectionId) state.connecting = false;
  }
}

function receiveRealtimeEvent(message) {
  let event;
  try { event = JSON.parse(message.data); } catch { return; }
  if (event.type === 'input_audio_buffer.speech_started') setStatus('HEARING YOU');
  if (event.type === 'input_audio_buffer.speech_stopped') setStatus('PROCESSING YOUR REQUEST');
  if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
    const transcript = String(event.transcript).trim();
    const itemId = event.item_id || `${Date.now()}-${transcript}`;
    state.lastUserText = transcript;
    if (transcript && !state.renderedTranscriptIds.has(itemId)) {
      state.renderedTranscriptIds.add(itemId);
      addMessage('user', transcript);
    }
  }
  if (event.type === 'response.output_text.delta') state.responseText += event.delta || '';
  if (event.type === 'response.output_audio_transcript.delta') state.responseAudioText += event.delta || '';
  if (event.type === 'response.created') {
    state.responseText = '';
    state.responseAudioText = '';
    setStatus('WAYFINDER IS RESPONDING');
  }
  if (event.type === 'response.done') {
    const response = event.response || {};
    const calls = (response.output || []).filter((item) => item.type === 'function_call');
    const spoken = state.responseAudioText.trim() || state.responseText.trim() || extractRealtimeText(response.output);
    if (calls.length) { calls.forEach(handleRealtimeToolCall); return; }
    if (spoken) addMessage('assistant', spoken);
    if (state.pendingStopListening) {
      state.pendingStopListening = false;
      disconnectVoice();
      showToast('Voice session ended as requested.');
      return;
    }
    setStatus(response.status === 'failed' ? 'RESPONSE FAILED · STILL LISTENING' : 'LISTENING · SPEAK WHEN READY');
  }
  if (event.type === 'error') showToast(event.error?.message || 'The voice session returned an error.');
}

function extractRealtimeText(output = []) {
  const chunks = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.text) chunks.push(content.text);
      if (content.transcript) chunks.push(content.transcript);
    }
  }
  return chunks.join('\n').trim();
}

async function handleRealtimeToolCall(call) {
  let args = {};
  try { args = JSON.parse(call.arguments || '{}'); } catch { /* Use the last recognized phrase. */ }
  const utterance = String(args.user_utterance || state.lastUserText || '').trim();
  const intent = normalizeIntent(args.intent);
  setBusy(true);
  let payload;
  try {
    if (!utterance) throw new Error('I could not hear that clearly. Please say it again.');
    const result = await request('/api/respond', { intent, utterance, context: String(args.conversation_context || '').slice(0, 2_500) });
    addGatewayResult(result);
    payload = { status: 'completed', intent: result.intent, routed_model: result.model, assistant_reply: result.text, tool_call: result.tool_call, tool_result: result.tool_result, stop_listening: result.stop_listening };
    if (result.stop_listening) state.pendingStopListening = true;
  } catch (error) {
    payload = { status: 'unavailable', assistant_reply: error.message || 'The AI gateway is unavailable. Please try again.' };
    showToast(payload.assistant_reply);
  }
  if (state.channel?.readyState === 'open') {
    state.channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(payload) } }));
    state.channel.send(JSON.stringify({ type: 'response.create' }));
  }
  setBusy(false);
}

function normalizeIntent(intent) {
  return ['route', 'traffic', 'fuel', 'weather', 'trip_report', 'chat', 'stop_listening', 'general'].includes(intent) ? intent : null;
}

function addGatewayResult(result) {
  const card = document.createElement('article');
  card.className = 'gateway-card';
  const head = document.createElement('div');
  head.className = 'gateway-head';
  const dot = document.createElement('i');
  const label = document.createElement('span');
  label.textContent = `AI GATEWAY · ${String(result.intent || 'general').replaceAll('_', ' ').toUpperCase()} · ${String(result.model || '').toUpperCase()}`;
  head.append(dot, label);
  card.append(head);
  const rows = summarizeTool(result.tool_call?.name, result.tool_result);
  rows.forEach(([name, value]) => {
    const row = document.createElement('div');
    row.className = 'gateway-line';
    const key = document.createElement('span'); key.textContent = name;
    const val = document.createElement('strong'); val.textContent = String(value);
    row.append(key, val); card.append(row);
  });
  if (result.tool_call?.name === 'send_trip_summary_email') {
    const note = document.createElement('div'); note.className = 'gateway-note'; note.textContent = 'SIMULATED · no email was sent'; card.append(note);
  }
  ui.messages.append(card);
  if (result.search_performed || result.sources?.length) addSearchSources(result.sources || []);
  scrollToBottom();
}

function summarizeTool(name, result = {}) {
  if (!name || !result) return [];
  if (name === 'web_search') return [['Search tool', 'OpenAI Web Search'], ['Cited sources', result.source_count || 0]];
  if (name === 'get_personalized_route') return [['Route', result.primary_highway], ['Distance', `${result.distance_km} km`], ['Estimated drive', formatMinutes(result.estimated_duration_min)]];
  if (name === 'reroute_optimal_path') return [['Incident', 'Fixture traffic alert'], ['Suggested route', 'Bypass via South Daejeon IC'], ['Time saved', `${result.time_saved_min} min`]];
  if (name === 'search_nearby_amenities') return (result.stations || []).slice(0, 3).map((station) => [station.name, `${station.distance_km} km · ₩${formatNumber(station.gasoline_krw)}/L`]);
  if (name === 'send_trip_summary_email') return [['Trip', `${result.telemetry_summary?.total_distance_km || 352.4} km · ${result.telemetry_summary?.duration_formatted || '3 hrs 48 mins'}`], ['Eco-score', `${result.telemetry_summary?.eco_score || 88}/100`], ['Recipient', result.recipient_email]];
  return [];
}

function addSearchSources(sources) {
  const card = document.createElement('article');
  card.className = 'gateway-card search-sources';
  const head = document.createElement('div');
  head.className = 'gateway-head';
  const dot = document.createElement('i');
  const label = document.createElement('span');
  label.textContent = 'WEB SEARCH SOURCES';
  head.append(dot, label);
  card.append(head);
  const list = document.createElement('div');
  list.className = 'search-source-list';
  for (const source of sources.slice(0, 8)) {
    let url;
    try { url = new URL(source.url); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const link = document.createElement('a');
    link.href = url.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.title || url.hostname;
    const host = document.createElement('small');
    host.textContent = url.hostname;
    const row = document.createElement('div');
    row.className = 'search-source';
    row.append(link, host);
    list.append(row);
  }
  if (!list.childElementCount) {
    const note = document.createElement('div');
    note.className = 'search-source-empty';
    note.textContent = 'No clickable source links were returned. Treat this result as unverified.';
    card.append(note);
  } else card.append(list);
  ui.messages.append(card);
}

function addMessage(role, text) {
  ui.welcome.classList.add('hidden');
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const label = document.createElement('div'); label.className = 'message-meta'; label.textContent = role === 'user' ? 'YOU' : 'WAYFINDER';
  const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = text;
  article.append(label, bubble);
  ui.messages.append(article);
  scrollToBottom();
}

function setBusy(value) {
  state.busy = value;
  ui.send.disabled = value;
  ui.thinking.classList.toggle('hidden', !value);
  if (value) setStatus('WAYFINDER IS THINKING');
  else if (state.channel?.readyState === 'open') setStatus('LISTENING · SPEAK WHEN READY');
  scrollToBottom();
}

function setStatus(value) {
  ui.status.textContent = value;
  ui.connection.classList.toggle('listening', Boolean(state.pc || state.connecting));
}

function setVoiceActive(active) {
  ui.voice.classList.toggle('active', active);
  ui.voiceLabel.textContent = active ? 'End voice' : 'Start voice';
  ui.voice.setAttribute('aria-label', active ? 'End voice session' : 'Start voice session');
  if (active) ui.connection.classList.add('listening');
  else updateConnection();
}

function disconnectVoice() {
  state.connectionId += 1;
  state.connecting = false;
  clearTimeout(state.voiceTimer);
  state.voiceTimer = null;
  try { state.channel?.close(); } catch {}
  try { state.pc?.close(); } catch {}
  state.media?.getTracks().forEach((track) => track.stop());
  if (state.audio) { state.audio.srcObject = null; state.audio.remove(); }
  state.channel = null; state.pc = null; state.media = null; state.audio = null;
  state.pendingStopListening = false;
  setVoiceActive(false);
  setStatus('READY WHEN YOU ARE');
}

async function request(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (data.accessRequired) { state.authorized = false; openAccessGate(); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function resizeInput() {
  ui.input.style.height = 'auto';
  ui.input.style.height = `${Math.min(ui.input.scrollHeight, 92)}px`;
}

function scrollToBottom() { ui.chat.scrollTop = ui.chat.scrollHeight; }
function formatMinutes(value = 0) { return `${Math.floor(value / 60)} hr ${value % 60} min`; }
function formatNumber(value = 0) { return new Intl.NumberFormat('en-US').format(value); }

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove('visible'), 3_600);
}

initialize();
