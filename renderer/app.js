const state = {
  settings: {},
  server: { url: 'https://www.aprsnet.uk', ws: 'wss://www.aprsnet.uk/ws' },
  ws: null,
  authed: false,
  stations: new Map(),
  packets: [],
  packetTimes: [],
  messages: []
};

const $ = (id) => document.getElementById(id);
const clean = (value) => String(value || '').trim();
const call = (value) => clean(value).toUpperCase();
const baseCall = (value) => call(value).split('-')[0];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function age(ts) {
  if (!ts) return '-';
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - Number(ts)));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function setPill(id, status, text) {
  const node = $(id);
  node.className = `pill ${status}`;
  node.textContent = text;
}

async function api(path, options = {}) {
  const response = await window.aprsnet.api({ path, method: options.method || 'GET', body: options.body, headers: options.headers });
  setPill('api-state', response.ok ? 'ok' : 'bad', response.ok ? 'API online' : 'API issue');
  return response;
}

function source(ssid = '') {
  const configured = call(state.settings.callsign);
  const suffix = clean(ssid).replace(/^-/, '');
  if (!configured) return suffix ? `NOCALL-${suffix}` : 'NOCALL';
  return suffix ? `${baseCall(configured)}-${suffix}` : configured;
}

function encodeCoord(latValue, lonValue) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Valid latitude and longitude are required.');
  }
  const latDeg = Math.floor(Math.abs(lat));
  const lonDeg = Math.floor(Math.abs(lon));
  const latMin = ((Math.abs(lat) - latDeg) * 60).toFixed(2).padStart(5, '0');
  const lonMin = ((Math.abs(lon) - lonDeg) * 60).toFixed(2).padStart(5, '0');
  return `${String(latDeg).padStart(2, '0')}${latMin}${lat >= 0 ? 'N' : 'S'}/${String(lonDeg).padStart(3, '0')}${lonMin}${lon >= 0 ? 'E' : 'W'}`;
}

function messagePacket() {
  const to = call($('message-to').value);
  const text = clean($('message-text').value).slice(0, 67);
  const id = clean($('message-id').value).slice(0, 5);
  if (!to || !text) throw new Error('Destination and message text are required.');
  return `${source()}>APRS,TCPIP*::${to.padEnd(9, ' ').slice(0, 9)}:${text}${id ? `{${id}` : ''}`;
}

function beaconPacket() {
  const ssid = clean($('beacon-ssid').value) || '9';
  if (!/^(1[0-5]|[0-9])$/.test(ssid)) throw new Error('SSID must be 0-15.');
  return `${source(ssid)}>APRS,TCPIP*:=` + `${encodeCoord($('beacon-lat').value, $('beacon-lon').value)}>${clean($('beacon-comment').value).slice(0, 43)}`;
}

function objectPacket() {
  const name = call($('object-name').value).padEnd(9, ' ').slice(0, 9);
  if (!name.trim()) throw new Error('Object name is required.');
  const now = new Date();
  const stamp = `${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}z`;
  return `${source()}>APRS,TCPIP*:;${name}*${stamp}${encodeCoord($('object-lat').value, $('object-lon').value)}O${clean($('object-comment').value).slice(0, 36)}`;
}

function rawPacket() {
  const packet = clean($('raw-packet').value);
  if (!packet.includes('>')) throw new Error('Raw packet needs a source and path.');
  if (baseCall(packet.split('>')[0]) !== baseCall(state.settings.callsign)) throw new Error('Raw source must match your configured callsign.');
  return packet;
}

function updatePreviews() {
  for (const [id, builder] of [['message-preview', messagePacket], ['beacon-preview', beaconPacket], ['object-preview', objectPacket]]) {
    try { $(id).textContent = builder(); } catch (err) { $(id).textContent = err.message; }
  }
}

async function loadStatus() {
  const response = await api('/api/status');
  if (!response.ok) return;
  const data = response.data || {};
  $('metric-packets').textContent = Number(data.pkts_rx || 0).toLocaleString();
  $('metric-clients').textContent = Array.isArray(data.clients) ? data.clients.length : (data.client_count || '-');
  $('metric-tcp').textContent = `${data.tcp_clients || 0} TCP`;
  $('metric-uptime').textContent = data.uptime || '-';
  $('metric-ring').textContent = `ring ${data.ring_size || '-'}`;
}

async function loadStations() {
  const response = await api('/api/export/geojson');
  if (!response.ok || !response.data || !Array.isArray(response.data.features)) return;
  for (const feature of response.data.features) {
    const coords = feature.geometry?.coordinates || [];
    const props = feature.properties || {};
    const stationCall = props.callsign || props.name;
    if (!stationCall || coords.length < 2) continue;
    state.stations.set(stationCall, {
      call: stationCall,
      lon: Number(coords[0]),
      lat: Number(coords[1]),
      ts: props.timestamp || props.ts,
      path: props.path || '',
      type: props.type || 'station'
    });
  }
  renderStations();
  drawMap();
}

async function loadMessages() {
  const response = await api('/api/messages');
  if (!response.ok) return;
  const rows = Array.isArray(response.data) ? response.data : (response.data?.messages || []);
  state.messages = rows.slice(-100).reverse();
  renderMessages();
}

async function loadWeather() {
  const response = await api('/api/wx/warnings');
  const grid = $('weather-grid');
  if (!response.ok) {
    grid.innerHTML = '<article><strong>Weather unavailable</strong><p>APRSNET did not return warning data.</p></article>';
    return;
  }
  const items = Array.isArray(response.data) ? response.data : (response.data?.warnings || []);
  grid.innerHTML = items.length
    ? items.map(item => `<article><strong>${esc(item.headline || item.event || 'Warning')}</strong><p>${esc(item.description || item.area || JSON.stringify(item).slice(0, 220))}</p></article>`).join('')
    : '<article><strong>No warnings</strong><p>No active APRSNET weather warnings returned.</p></article>';
}

async function loadAnalytics() {
  const response = await api('/api/analytics');
  const grid = $('analytics-grid');
  if (!response.ok) {
    grid.innerHTML = '<article><strong>Analytics unavailable</strong><p>APRSNET did not return analytics data.</p></article>';
    return;
  }
  grid.innerHTML = Object.entries(response.data || {}).slice(0, 16)
    .map(([key, value]) => `<article><strong>${esc(key)}</strong><p>${esc(typeof value === 'object' ? JSON.stringify(value).slice(0, 240) : value)}</p></article>`)
    .join('') || '<article><strong>No analytics</strong><p>No analytics fields were returned.</p></article>';
}

async function loginMember() {
  if (!state.settings.autoMemberLogin || !state.settings.memberUser || !state.settings.memberPass) return;
  const response = await api('/api/member/login', {
    method: 'POST',
    body: { callsign: state.settings.memberUser, password: state.settings.memberPass }
  });
  if (response.ok && response.data?.token) {
    state.settings = await window.aprsnet.saveSettings({ memberToken: response.data.token });
  }
}

function connectWebSocket() {
  if (state.ws) state.ws.close();
  state.ws = new WebSocket(state.server.ws);
  setPill('ws-state', 'warn', 'WS connecting');
  state.ws.addEventListener('open', () => {
    setPill('ws-state', 'ok', 'WS live');
    authWebSocket();
  });
  state.ws.addEventListener('close', () => {
    state.authed = false;
    setPill('ws-state', 'bad', 'WS offline');
    setPill('auth-state', 'warn', 'RX only');
    setTimeout(connectWebSocket, 3000);
  });
  state.ws.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch (err) { return; }
    if (message.type === 'auth_ack') {
      state.authed = message.status === 'success';
      setPill('auth-state', state.authed ? 'ok' : 'warn', state.authed ? `TX ${message.callsign || state.settings.callsign}` : 'RX only');
      return;
    }
    if (['rx', 'obj', 'sys', 'alert', 'tx'].includes(message.type)) addPacket(message.packet || message.message || JSON.stringify(message), message.type);
    if ((message.type === 'rx' || message.type === 'obj') && message.data) {
      const item = message.data;
      const stationCall = item.call || item.callsign;
      if (stationCall && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))) {
        state.stations.set(stationCall, { call: stationCall, lat: Number(item.lat), lon: Number(item.lon), ts: item.ts || Math.round(Date.now() / 1000), path: item.path || '', type: message.type === 'obj' ? 'object' : 'station' });
        renderStations();
        drawMap();
      }
    }
    if (message.type === 'msg_history' && message.data) {
      state.messages.unshift(...(Array.isArray(message.data) ? message.data : [message.data]));
      renderMessages();
    }
    if (message.type === 'alert') window.aprsnet.notify('APRSNET Alert', message.message || message.packet || 'New alert');
  });
}

function authWebSocket() {
  if (!state.settings.callsign || !state.settings.passcode || state.ws?.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type: 'auth', callsign: baseCall(state.settings.callsign), passcode: state.settings.passcode, software: 'APRSNET Desktop' }));
}

function addPacket(packet, type) {
  state.packets.unshift({ packet, type, ts: Date.now() });
  state.packets = state.packets.slice(0, 150);
  state.packetTimes.push(Date.now());
  state.packetTimes = state.packetTimes.filter(ts => Date.now() - ts < 60000);
  $('metric-rate').textContent = `${state.packetTimes.length}/min`;
  renderPackets();
}

function renderPackets() {
  $('packet-feed').innerHTML = state.packets.map(item => `<div class="feed-row"><header><span>${esc(item.type)}</span><span>${new Date(item.ts).toLocaleTimeString()}</span></header><code>${esc(item.packet)}</code></div>`).join('') || '<div class="feed-row">Waiting for APRSNET packets...</div>';
}

function renderMessages() {
  $('message-feed').innerHTML = state.messages.slice(0, 80).map(item => `<div class="feed-row"><header><span><button class="call-button" data-call="${esc(item.from || '')}">${esc(item.from || '?')}</button> to ${esc(item.to || '?')}</span><span>${age(item.ts)}</span></header><code>${esc(item.text || item.packet || '')}</code></div>`).join('') || '<div class="feed-row">No messages returned yet.</div>';
}

function renderStations() {
  const rows = [...state.stations.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('metric-stations').textContent = rows.length;
  $('metric-objects').textContent = `${rows.filter(row => row.type === 'object').length} objects`;
  $('station-table').innerHTML = rows.slice(0, 90).map(row => `<tr><td><button class="call-button" data-call="${esc(row.call)}">${esc(row.call)}</button></td><td>${age(row.ts)}</td><td>${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}</td><td><code>${esc(row.path || '-')}</code></td></tr>`).join('');
}

function drawMap() {
  const canvas = $('map');
  if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
  const ctx = canvas.getContext('2d');
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * scale);
  canvas.height = Math.floor(canvas.clientHeight * scale);
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.strokeStyle = 'rgba(39,217,154,.14)';
  for (let x = 50; x < canvas.clientWidth; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.clientHeight); ctx.stroke(); }
  for (let y = 50; y < canvas.clientHeight; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.clientWidth, y); ctx.stroke(); }
  const stations = [...state.stations.values()].filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!stations.length) return;
  const minLat = Math.min(...stations.map(s => s.lat));
  const maxLat = Math.max(...stations.map(s => s.lat));
  const minLon = Math.min(...stations.map(s => s.lon));
  const maxLon = Math.max(...stations.map(s => s.lon));
  const pad = 36;
  const watch = new Set(clean($('watchlist').value).toUpperCase().split(/[,\s]+/).filter(Boolean));
  stations.forEach(station => {
    const x = pad + ((station.lon - minLon) / Math.max(0.001, maxLon - minLon)) * (canvas.clientWidth - pad * 2);
    const y = canvas.clientHeight - pad - ((station.lat - minLat) / Math.max(0.001, maxLat - minLat)) * (canvas.clientHeight - pad * 2);
    ctx.fillStyle = watch.has(station.call.toUpperCase()) ? '#f1bd55' : (station.type === 'object' ? '#65b7ff' : '#27d99a');
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ecfff6'; ctx.font = '12px Segoe UI'; ctx.fillText(station.call, x + 8, y + 4);
  });
}

function transmit(builder) {
  if (!state.authed || state.ws?.readyState !== WebSocket.OPEN) {
    alert('Set callsign/passcode in Settings and wait for TX authentication.');
    return;
  }
  let packet;
  try { packet = builder(); } catch (err) { alert(err.message); return; }
  if (!confirm(`Transmit this APRS packet?\n\n${packet}`)) return;
  state.ws.send(JSON.stringify({ type: 'tx', packet }));
  addPacket(packet, 'tx');
}

async function saveSettings() {
  state.settings = await window.aprsnet.saveSettings({
    callsign: call($('set-callsign').value),
    passcode: clean($('set-passcode').value),
    memberUser: clean($('set-member-user').value),
    memberPass: $('set-member-pass').value,
    manualLat: clean($('set-lat').value) === '' ? null : Number($('set-lat').value),
    manualLon: clean($('set-lon').value) === '' ? null : Number($('set-lon').value),
    notifications: $('set-notifications').checked,
    minimizeToTray: $('set-tray').checked,
    launchOnStartup: $('set-startup').checked,
    watchlist: $('watchlist').value
  });
  authWebSocket();
  updatePreviews();
}

function hydrateSettings() {
  $('set-callsign').value = state.settings.callsign || '';
  $('set-passcode').value = state.settings.passcode || '';
  $('set-member-user').value = state.settings.memberUser || '';
  $('set-member-pass').value = state.settings.memberPass || '';
  $('set-lat').value = state.settings.manualLat ?? '';
  $('set-lon').value = state.settings.manualLon ?? '';
  $('set-notifications').checked = state.settings.notifications !== false;
  $('set-tray').checked = state.settings.minimizeToTray !== false;
  $('set-startup').checked = !!state.settings.launchOnStartup;
  $('watchlist').value = state.settings.watchlist || '';
  if (state.settings.manualLat !== null && state.settings.manualLat !== undefined) $('beacon-lat').value = state.settings.manualLat;
  if (state.settings.manualLon !== null && state.settings.manualLon !== undefined) $('beacon-lon').value = state.settings.manualLon;
}

function switchView(name) {
  document.querySelectorAll('.nav').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
  const copy = {
    dashboard: ['Dashboard', 'Live APRSNET status, packets, stations and operational state.'],
    map: ['Tactical Map', 'Native station plot fed by APRSNET GeoJSON and WebSocket updates.'],
    messages: ['Messages', 'Read recent APRS messages and transmit through authenticated APRSNET WebSocket.'],
    transmit: ['Transmit', 'Build and preview APRS messages, beacons, objects and raw packets.'],
    weather: ['Weather', 'Weather warning data from APRSNET APIs.'],
    analytics: ['Analytics', 'Network, propagation and activity analytics from APRSNET.'],
    settings: ['Settings', 'Credentials, position and desktop integration.']
  }[name];
  $('view-title').textContent = copy[0];
  $('view-copy').textContent = copy[1];
  if (name === 'map') setTimeout(drawMap, 50);
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadStations(), loadMessages(), loadWeather(), loadAnalytics()]);
}

async function init() {
  state.settings = await window.aprsnet.getSettings();
  state.server = await window.aprsnet.getServer();
  $('app-version').textContent = `v${await window.aprsnet.getVersion()}`;
  hydrateSettings();
  updatePreviews();

  document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.querySelectorAll('input, textarea').forEach(node => node.addEventListener('input', () => { updatePreviews(); drawMap(); }));
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-call]');
    if (!button) return;
    $('message-to').value = button.dataset.call;
    switchView('messages');
    updatePreviews();
  });

  $('open-site').addEventListener('click', () => window.aprsnet.openExternal(state.server.url));
  $('refresh-now').addEventListener('click', refreshAll);
  $('refresh-messages').addEventListener('click', loadMessages);
  $('refresh-weather').addEventListener('click', loadWeather);
  $('refresh-analytics').addEventListener('click', loadAnalytics);
  $('clear-packets').addEventListener('click', () => { state.packets = []; renderPackets(); });
  $('fit-map').addEventListener('click', drawMap);
  $('send-message').addEventListener('click', () => transmit(messagePacket));
  $('send-beacon').addEventListener('click', () => transmit(beaconPacket));
  $('send-object').addEventListener('click', () => transmit(objectPacket));
  $('send-raw').addEventListener('click', () => transmit(rawPacket));
  $('save-settings').addEventListener('click', saveSettings);
  $('use-position').addEventListener('click', async () => {
    const position = await window.aprsnet.getPosition();
    if (!position) return;
    $('beacon-lat').value = position.lat;
    $('beacon-lon').value = position.lon;
    updatePreviews();
  });

  await loginMember();
  await refreshAll();
  connectWebSocket();
  setInterval(loadStatus, 15000);
  setInterval(loadStations, 60000);
  setInterval(loadMessages, 45000);
}

window.addEventListener('load', init);
