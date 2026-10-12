const state = {
  data: null,
  apiReady: false,
  authorized: true,
  accessRequired: false,
  serverManagedApiKey: false,
  busy: false,
  connecting: false,
  connectionId: 0,
  pc: null,
  channel: null,
  media: null,
  audio: null,
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
const nodes = {
  apiState: $('#api-state'), apiStateLabel: $('#api-state-label'), examples: $('#step-list'),
  chat: $('#chat-scroll'), messages: $('#messages'), welcome: $('#welcome-card'), input: $('#chat-input'),
  typing: $('#typing-indicator'), status: $('#assistant-status'), voice: $('#voice-button'),
  voiceLabel: $('#voice-button-label'), send: $('#send-button'), sample: $('#use-sample'),
  sampleText: $('#suggestion-text'), composeNote: $('#compose-note'), toast: $('#toast'),
  keyModal: $('#key-modal'), keyInput: $('#api-key-input'), keyError: $('#key-error'), keySave: $('#key-save'),
  accessModal: $('#access-modal'), accessForm: $('#access-form'), accessInput: $('#access-code-input'),
  accessError: $('#access-error'), accessSubmit: $('#access-submit'),
};

const sampleLabels = ['Plan a route', 'Avoid traffic', 'Find fuel', 'Tell me a joke', 'Trip report'];

async function initialize() {
  try {
    const statusResponse = await fetch('/api/status');
    if (!statusResponse.ok) throw new Error('Prototype status is unavailable.');
    const status = await statusResponse.json();
    state.apiReady = status.apiReady;
    state.authorized = status.authorized;
    state.accessRequired = status.accessRequired;
    state.serverManagedApiKey = status.serverManagedApiKey;
    updateApiStatus(status);
    if (state.authorized) await loadScenarios();
    else openAccessGate();
    $('#profile-toggle').addEventListener('click', () => $('#profile-extra').classList.toggle('hidden'));
    $('#chat-form').addEventListener('submit', sendMessage);
    nodes.sample.addEventListener('click', fillSample);
    nodes.voice.addEventListener('click', toggleVoice);
    nodes.apiState.addEventListener('click', openKeySettings);
    $('#key-form').addEventListener('submit', saveApiKey);
    $('#key-close').addEventListener('click', closeKeySettings);
    $('#key-cancel').addEventListener('click', closeKeySettings);
    $('#key-visibility').addEventListener('click', toggleKeyVisibility);
    nodes.accessForm.addEventListener('submit', submitAccessCode);
    $('#access-visibility').addEventListener('click', toggleAccessVisibility);
    nodes.examples.addEventListener('click', selectExample);
    nodes.keyModal.addEventListener('click', (event) => { if (event.target === nodes.keyModal) closeKeySettings(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeKeySettings(); });
    $('#center-route').addEventListener('click', () => showToast('This is an illustrative route map. Ask Wayfinder about any journey.'));
    document.querySelectorAll('.map-zoom button').forEach((button, index) => {
      button.addEventListener('click', () => { $('#map-canvas').classList.toggle('zoomed', index === 0); });
    });
    nodes.input.addEventListener('input', resizeInput);
    nodes.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chat-form').requestSubmit(); }
    });
  } catch (error) {
    showToast(error.message || 'Could not load this prototype.');
    nodes.apiStateLabel.textContent = 'Local setup unavailable';
  }
}

async function loadScenarios() {
  const response = await fetch('/api/scenarios');
  if (!response.ok) throw new Error('Prototype data is unavailable.');
  state.data = await response.json();
  renderExamples();
}

function updateApiStatus(serverStatus) {
  nodes.apiState.classList.toggle('ready', state.apiReady);
  nodes.apiStateLabel.textContent = state.serverManagedApiKey
    ? (state.apiReady ? 'Hosted API · ready' : 'Hosted API unavailable')
    : (state.apiReady ? 'OpenAI API ready' : 'Mock mode · API key needed');
  nodes.voice.title = state.apiReady ? 'Start the continuous Realtime voice session' : 'Connect an API key, then start voice';
  nodes.composeNote.textContent = state.serverManagedApiKey
    ? 'Private preview · shared host API'
    : (state.apiReady ? 'Prototype fixtures · OpenAI connected' : 'Prototype fixtures · OpenAI not configured');
  document.documentElement.dataset.fastModel = serverStatus.models.fast;
  document.documentElement.dataset.complexModel = serverStatus.models.complex;
}

function openKeySettings() {
  if (state.accessRequired && !state.authorized) { openAccessGate(); return; }
  if (state.serverManagedApiKey) { showToast('The OpenAI API is securely managed by the demo host.'); return; }
  nodes.keyError.classList.add('hidden');
  nodes.keyInput.value = '';
  nodes.keyModal.classList.remove('hidden');
  setTimeout(() => nodes.keyInput.focus(), 20);
}

function openAccessGate() {
  nodes.accessModal.classList.remove('hidden');
  setTimeout(() => nodes.accessInput.focus(), 30);
}

function toggleAccessVisibility() {
  const button = $('#access-visibility');
  const show = nodes.accessInput.type === 'password';
  nodes.accessInput.type = show ? 'text' : 'password';
  button.textContent = show ? 'HIDE' : 'SHOW';
}

async function submitAccessCode(event) {
  event.preventDefault();
  nodes.accessSubmit.disabled = true;
  nodes.accessError.classList.add('hidden');
  try {
    await request('/api/access', { accessCode: nodes.accessInput.value });
    nodes.accessInput.value = '';
    const response = await fetch('/api/status');
    const status = await response.json();
    state.authorized = status.authorized;
    state.apiReady = status.apiReady;
    state.serverManagedApiKey = status.serverManagedApiKey;
    updateApiStatus(status);
    if (!state.authorized) throw new Error('Access could not be confirmed. Please try again.');
    nodes.accessModal.classList.add('hidden');
    await loadScenarios();
    showToast('Access granted. The host manages the API connection securely.');
  } catch (error) {
    nodes.accessError.textContent = error.message || 'Could not verify that code.';
    nodes.accessError.classList.remove('hidden');
    nodes.accessInput.select();
  } finally {
    nodes.accessSubmit.disabled = false;
  }
}

function closeKeySettings() {
  nodes.keyModal.classList.add('hidden');
  nodes.keyInput.value = '';
  nodes.keyInput.type = 'password';
  $('#key-visibility').textContent = 'SHOW';
  nodes.keyError.classList.add('hidden');
}

function toggleKeyVisibility() {
  const show = nodes.keyInput.type === 'password';
  nodes.keyInput.type = show ? 'text' : 'password';
  $('#key-visibility').textContent = show ? 'HIDE' : 'SHOW';
}

async function saveApiKey(event) {
  event.preventDefault();
  const key = nodes.keyInput.value.trim();
  if (!key) {
    nodes.keyError.textContent = 'Enter a new API key to connect.';
    nodes.keyError.classList.remove('hidden');
    return;
  }
  nodes.keySave.disabled = true;
  nodes.keySave.textContent = 'CONNECTING…';
  nodes.keyError.classList.add('hidden');
  try {
    await request('/api/config', { apiKey: key });
    state.apiReady = true;
    const statusResponse = await fetch('/api/status');
    const status = await statusResponse.json();
    updateApiStatus(status);
    closeKeySettings();
    showToast('OpenAI API connected. The key stays in local server memory.');
  } catch (error) {
    nodes.keyError.textContent = error.message || 'Could not connect this API key.';
    nodes.keyError.classList.remove('hidden');
  } finally {
    nodes.keySave.disabled = false;
    nodes.keySave.innerHTML = 'Connect API <svg viewBox="0 0 16 16" fill="none"><path d="M3 8h9m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
}

function renderExamples() {
  nodes.examples.replaceChildren();
  state.data.scenarios.forEach((scenario, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step-button';
    button.dataset.sample = scenario.user_utterance;
    const number = document.createElement('span');
    number.className = 'step-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span');
    copy.className = 'step-copy';
    const category = document.createElement('span');
    category.className = 'step-phase';
    category.textContent = ['ROUTE', 'TRAFFIC', 'FUEL', 'CHAT', 'TRIP REPORT'][index];
    const title = document.createElement('span');
    title.className = 'step-title';
    title.textContent = sampleLabels[index];
    const utterance = document.createElement('span');
    utterance.className = 'step-summary';
    utterance.textContent = scenario.user_utterance;
    copy.append(category, title, utterance);
    button.append(number, copy);
    nodes.examples.append(button);
  });
}

function selectExample(event) {
  const button = event.target.closest('[data-sample]');
  if (!button) return;
  setSample(button.dataset.sample);
}

function fillSample() {
  if (!state.data) return;
  const current = nodes.sample.dataset.sample || state.data.scenarios[0].user_utterance;
  setSample(current);
}

function setSample(query) {
  nodes.sample.dataset.sample = query;
  nodes.sampleText.textContent = 'Example loaded · edit it or speak your own request';
  nodes.input.value = query;
  resizeInput();
  nodes.input.focus();
}

async function sendMessage(event) {
  event.preventDefault();
  const utterance = nodes.input.value.trim();
  if (!utterance || state.busy) return;
  const context = recentConversationContext();
  nodes.input.value = '';
  resizeInput();
  state.lastUserText = utterance;
  if (state.channel?.readyState === 'open') {
    addMessage('user', utterance);
    sendRealtimeText(utterance);
    return;
  }
  if (!state.apiReady) {
    nodes.input.value = utterance;
    resizeInput();
    showToast('Connect an API key from the top-right settings before sending a live request.');
    return;
  }
  addMessage('user', utterance);
  setBusy(true);
  try {
    const result = await request('/api/respond', { utterance, context });
    showGatewayResult(result);
    addMessage('assistant', result.text);
    nodes.status.textContent = `ROUTED TO ${String(result.model).toUpperCase()}`;
    if (result.stop_listening) showToast('This text-only request does not have an active voice session.');
  } catch (error) {
    addMessage('assistant', error.message || 'I could not reach OpenAI just now. Please try again.');
  } finally {
    setBusy(false);
  }
}

function recentConversationContext() {
  return [...nodes.messages.querySelectorAll('.message')].slice(-8).map((message) => {
    const role = message.classList.contains('user') ? 'Driver' : 'Assistant';
    return `${role}: ${message.querySelector('.message-bubble')?.textContent || ''}`;
  }).join('\n').slice(-2_500);
}

function showGatewayResult(result) {
  addGatewayCard(result.model, result.intent);
  if (result.tool_call && result.tool_result) {
    addToolCard(result.tool_call.name, result.tool_call.arguments, result.tool_result, result.model);
  }
}

function addMessage(role, text) {
  nodes.welcome.classList.add('hidden');
  const article = document.createElement('article');
  article.className = `message ${role}`;
  const meta = document.createElement('span');
  meta.className = 'message-meta';
  meta.textContent = role === 'user' ? 'YOU' : 'WAYFINDER';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;
  article.append(meta, bubble);
  nodes.messages.append(article);
  scrollChatToBottom();
  return article;
}

function addGatewayCard(model, intent) {
  const card = document.createElement('div');
  card.className = 'tool-card gateway-card';
  const head = document.createElement('div');
  head.className = 'tool-card-head';
  const badge = document.createElement('span');
  head.append(badge, document.createTextNode(`AI GATEWAY · ${String(intent || 'general').replaceAll('_', ' ').toUpperCase()} · ${String(model || '').toUpperCase()}`));
  card.append(head);
  nodes.messages.append(card);
  scrollChatToBottom();
}

function addToolCard(name, args, result, model = '') {
  nodes.welcome.classList.add('hidden');
  const card = document.createElement('div');
  card.className = 'tool-card';
  const head = document.createElement('div');
  head.className = 'tool-card-head';
  const badge = document.createElement('span');
  head.append(badge, document.createTextNode(`FUNCTION · ${name}`));
  if (model) {
    const route = document.createElement('small');
    route.style.cssText = 'margin-left:auto;color:#788672;font-size:6px';
    route.textContent = `ROUTED · ${model.toUpperCase()}`;
    head.append(route);
  }
  card.append(head);
  const lines = document.createElement('div');
  lines.className = 'tool-lines';
  for (const [label, value] of toolSummary(name, result)) {
    const row = document.createElement('div');
    row.className = 'tool-line';
    const left = document.createElement('span'); left.textContent = label;
    const right = document.createElement('strong'); right.textContent = String(value);
    row.append(left, right); lines.append(row);
  }
  card.append(lines);
  if (name === 'send_trip_summary_email') {
    const note = document.createElement('div');
    note.className = 'mock-delivery-note';
    note.textContent = 'SIMULATED · no email sent';
    card.append(note);
  }
  const argsText = document.createElement('div');
  argsText.style.cssText = 'margin-top:6px;color:#687763;font-family:var(--mono);font-size:6px;overflow-wrap:anywhere';
  argsText.textContent = `tool payload · ${JSON.stringify(args)}`;
  card.append(argsText);
  nodes.messages.append(card);
  scrollChatToBottom();
}

function toolSummary(name, result) {
  if (name === 'get_personalized_route') return [['Best route', result.primary_highway], ['Distance / drive', `${result.distance_km} km · ${formatMinutes(result.estimated_duration_min)}`], ['Toll / arrival', `₩${formatNumber(result.toll_fee_krw)} · ${result.estimated_arrival}`]];
  if (name === 'reroute_optimal_path') return [['Incident', 'Multi-vehicle collision · 3 km ahead'], ['Suggested route', 'Bypass via South Daejeon IC'], ['Time saved / ETA', `${result.time_saved_min} min · ${result.new_eta}`]];
  if (name === 'search_nearby_amenities') return (result.stations || []).slice(0, 3).map((station) => [station.name, `${station.distance_km} km · ₩${formatNumber(station.gasoline_krw)}/L`]);
  if (name === 'send_trip_summary_email') return [['Trip report', `${result.telemetry_summary?.total_distance_km || 352.4} km · ${result.telemetry_summary?.duration_formatted || '3 hrs 48 mins'}`], ['Eco-score', `${result.telemetry_summary?.eco_score || 88}/100`], ['Recipient', result.recipient_email], ['Email delivery', 'Simulated only']];
  return [['Result', 'Fixture data returned']];
}

function formatMinutes(value) { return `${Math.floor(value / 60)} hr ${value % 60} min`; }
function formatNumber(value) { return new Intl.NumberFormat('en-US').format(value); }
function scrollChatToBottom() { nodes.chat.scrollTop = nodes.chat.scrollHeight; }
function resizeInput() { nodes.input.style.height = 'auto'; nodes.input.style.height = `${Math.min(nodes.input.scrollHeight, 91)}px`; }

function setBusy(busy) {
  state.busy = busy;
  nodes.send.disabled = busy;
  nodes.typing.classList.toggle('hidden', !busy);
  if (busy) nodes.status.textContent = 'WAYFINDER IS THINKING';
  else if (state.channel?.readyState === 'open') nodes.status.textContent = 'LISTENING · SPEAK WHEN READY';
  else if (state.pc || state.connecting) nodes.status.textContent = 'CONNECTING VOICE';
  else nodes.status.textContent = 'READY WHEN YOU ARE';
  if (busy) scrollChatToBottom();
}

async function request(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (data.accessRequired) { state.authorized = false; openAccessGate(); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setVoiceButton(active) {
  nodes.voice.classList.toggle('connected', active);
  nodes.voice.setAttribute('aria-label', active ? 'End voice session' : 'Start voice session');
  nodes.voice.title = active ? 'End the continuous Realtime voice session' : 'Start the continuous Realtime voice session';
  nodes.voiceLabel.textContent = active ? 'End voice' : 'Start voice';
}

async function toggleVoice() {
  if (state.pc || state.connecting) { disconnectVoice(); return; }
  if (!state.apiReady) {
    openKeySettings();
    showToast('Connect an API key, then press Start voice.');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    showToast('This browser does not support a live voice connection.');
    return;
  }
  await startVoice();
}

async function startVoice() {
  const connectionId = ++state.connectionId;
  state.connecting = true;
  nodes.voiceLabel.textContent = 'Connecting…';
  setBusy(true);
  nodes.status.textContent = 'REQUESTING MICROPHONE';
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (connectionId !== state.connectionId) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    state.media = media;
    state.pc = new RTCPeerConnection();
    state.audio = document.createElement('audio');
    state.audio.autoplay = true;
    state.audio.setAttribute('playsinline', '');
    document.body.append(state.audio);
    state.pc.ontrack = (event) => { state.audio.srcObject = event.streams[0]; };
    state.media.getTracks().forEach((track) => state.pc.addTrack(track, state.media));
    state.channel = state.pc.createDataChannel('oai-events');
    state.channel.addEventListener('message', receiveRealtimeEvent);
    state.channel.addEventListener('open', () => {
      if (connectionId !== state.connectionId) return;
      state.connecting = false;
      setVoiceButton(true);
      nodes.status.textContent = 'LISTENING · SPEAK WHEN READY';
      nodes.composeNote.textContent = 'Realtime voice active · English';
      state.voiceTimer = setTimeout(() => {
        disconnectVoice();
        showToast('This demo voice session reached its 30-minute limit. Start voice again to continue.');
      }, MAX_VOICE_SESSION_MS);
      setBusy(false);
      showToast('Voice is on. Speak naturally; Wayfinder replies after each turn.');
    });
    state.channel.addEventListener('close', () => {
      if (connectionId !== state.connectionId) return;
      nodes.status.textContent = 'VOICE DISCONNECTED';
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
      showToast(error.message || 'Could not connect voice. Check microphone permission and API access.');
    }
  } finally {
    if (connectionId === state.connectionId) {
      state.connecting = false;
      setBusy(false);
    }
  }
}

function sendRealtimeText(text) {
  if (state.channel?.readyState !== 'open') return showToast('Voice session is reconnecting. Please wait a moment.');
  state.channel.send(JSON.stringify({
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  }));
  state.channel.send(JSON.stringify({ type: 'response.create' }));
}

function receiveRealtimeEvent(message) {
  let event;
  try { event = JSON.parse(message.data); } catch { return; }
  if (event.type === 'input_audio_buffer.speech_started') {
    nodes.status.textContent = 'HEARING YOU';
  }
  if (event.type === 'input_audio_buffer.speech_stopped') {
    nodes.status.textContent = 'PROCESSING YOUR REQUEST';
  }
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
    nodes.status.textContent = 'WAYFINDER IS RESPONDING';
  }
  if (event.type === 'response.done') {
    const response = event.response || {};
    const functionCalls = (response.output || []).filter((item) => item.type === 'function_call');
    const spoken = state.responseAudioText.trim() || state.responseText.trim() || extractRealtimeText(response.output);
    if (functionCalls.length) {
      for (const toolCall of functionCalls) handleRealtimeToolCall(toolCall);
      return;
    }
    if (spoken) addMessage('assistant', spoken);
    if (state.pendingStopListening) {
      state.pendingStopListening = false;
      showToast('Voice session ended as requested.');
      disconnectVoice();
      return;
    }
    nodes.status.textContent = response.status === 'failed' ? 'RESPONSE FAILED · STILL LISTENING' : 'LISTENING · SPEAK WHEN READY';
  }
  if (event.type === 'error') {
    const messageText = event.error?.message || 'The voice session returned an error.';
    showToast(messageText);
  }
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
  try { args = JSON.parse(call.arguments || '{}'); } catch { /* the request will fall back to the latest transcript */ }
  const utterance = String(args.user_utterance || state.lastUserText || '').trim();
  const intent = normalizeIntent(args.intent) || inferIntent(utterance);
  let responsePayload;
  setBusy(true);
  try {
    if (!utterance) throw new Error('I could not hear that clearly. Please say it again.');
    const context = String(args.conversation_context || '').trim().slice(0, 2_500);
    const result = await request('/api/respond', { intent, utterance, context });
    showGatewayResult(result);
    if (result.stop_listening) state.pendingStopListening = true;
    responsePayload = {
      status: 'completed',
      intent: result.intent,
      routed_model: result.model,
      assistant_reply: result.text,
      tool_call: result.tool_call,
      tool_result: result.tool_result,
      stop_listening: result.stop_listening,
    };
  } catch (error) {
    responsePayload = { status: 'unavailable', assistant_reply: error.message || 'The AI gateway is unavailable. Please try again.' };
    showToast(responsePayload.assistant_reply);
  }
  if (state.channel?.readyState === 'open') {
    state.channel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(responsePayload) },
    }));
    state.channel.send(JSON.stringify({ type: 'response.create' }));
  }
  setBusy(false);
}

function normalizeIntent(intent) {
  const allowed = new Set(['route', 'traffic', 'fuel', 'trip_report', 'chat', 'stop_listening', 'general']);
  return allowed.has(intent) ? intent : null;
}

function inferIntent(text) {
  const value = text.toLowerCase();
  if (/\b(stop listening|end (the )?(voice )?session|turn off (the )?mic|mute (the )?microphone|stop recording)\b/.test(value)) return 'stop_listening';
  if (/\b(trip report|driving report|journey report|trip summary|drive summary|email me|send (me )?(the )?(trip|driving|journey)? ?(report|summary))\b/.test(value)) return 'trip_report';
  if (/\b(fuel|gas station|petrol|gasoline|diesel|refuel|fill up|charging station|ev charger)\b/.test(value)) return 'fuel';
  if (/\b(traffic|congestion|traffic jam|accident|crash|detour|rerout|roadblock|blocked road)\b/.test(value)) return 'traffic';
  if (/\b(route|directions|navigate|navigation|how do i get|drive to|way to)\b/.test(value)) return 'route';
  if (/\b(thank you|thanks|thank|joke|funny|bored|tired|hello|hi there|good morning|good afternoon)\b/.test(value)) return 'chat';
  return 'general';
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
  setVoiceButton(false);
  nodes.status.textContent = 'READY WHEN YOU ARE';
  nodes.composeNote.textContent = state.serverManagedApiKey
    ? 'Private preview · shared host API'
    : (state.apiReady ? 'Prototype fixtures · OpenAI connected' : 'Prototype fixtures · OpenAI not configured');
  setBusy(false);
}

function showToast(text) {
  nodes.toast.textContent = text;
  nodes.toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => nodes.toast.classList.remove('visible'), 4400);
}

initialize();
