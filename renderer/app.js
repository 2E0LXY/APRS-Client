const state = {
  settings: {},
  server: { url: 'https://www.aprsnet.uk', ws: 'wss://www.aprsnet.uk/ws' },
  ws: null,
  authed: false,
  stations: new Map(),
  packets: [],
  packetTimes: [],
  messages: [],
  selectedConversation: '',
  userLocation: null,
  map: { lat: 54.5, lon: -2.5, zoom: 6, dragging: false, dragStart: null, dragCenter: null, dragMoved: false, suppressClick: false, frame: null, lastDragDraw: 0, tileNodes: new Map(), markerNodes: new Map() }
};

const MAX_VISIBLE_MARKERS = 900;
const CLUSTER_ZOOM_LIMIT = 10;
const CLUSTER_CELL_SIZE = 58;

const $ = (id) => document.getElementById(id);
const clean = (value) => String(value || '').trim();
const call = (value) => clean(value).toUpperCase();
const baseCall = (value) => call(value).split('-')[0];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function coordValue(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function age(ts) {
  if (!ts) return '-';
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - Number(ts)));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function formatClock(ts) {
  if (!ts) return '';
  return new Date(Number(ts) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const toRad = n => n * Math.PI / 180;
  const r = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function userLocation() {
  const lat = coordValue(state.settings.manualLat);
  const lon = coordValue(state.settings.manualLon);
  if (lat !== null && lon !== null) return { lat, lon, source: 'saved manual location' };
  if (state.userLocation) return state.userLocation;
  return null;
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
  const lat = coordValue(latValue);
  const lon = coordValue(lonValue);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
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
      type: props.type || 'station',
      raw: props.raw || '',
      symbol: props.symbol || '',
      comment: props.comment || ''
    });
  }
  renderStations();
  renderWeatherStations();
  drawMap();
}

async function loadMessages() {
  const response = await api(state.settings.memberToken ? '/api/member/messages' : '/api/messages');
  if (!response.ok) return;
  const rows = Array.isArray(response.data) ? response.data : (response.data?.messages || []);
  state.messages = mergeMessages([...state.messages, ...rows]);
  renderMessages();
}

async function loadWeather() {
  renderWeatherStations();
  ensureUserLocation().then(renderWeatherStations);
}

async function loadAnalytics() {
  const response = await api('/api/analytics');
  if (!response.ok) {
    $('analytics-grid').innerHTML = '<section class="analytics-section">Analytics unavailable from APRSNET.</section>';
    return;
  }
  renderAnalytics(response.data || {});
}

async function loginMember() {
  if (!state.settings.autoMemberLogin || !state.settings.memberUser || !state.settings.memberPass) return;
  await verifyMemberLogin({ silent: true });
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function memberLoginAutofillPatch(data) {
  const user = data?.user || data?.member || data?.account || data?.profile || {};
  const callsign = firstValue(
    data?.callsign,
    data?.call,
    data?.aprs_callsign,
    data?.aprsCallsign,
    data?.station_callsign,
    data?.stationCallsign,
    user?.callsign,
    user?.call,
    user?.aprs_callsign,
    user?.aprsCallsign,
    user?.station_callsign,
    user?.stationCallsign
  );
  const passcode = firstValue(
    data?.passcode,
    data?.aprs_passcode,
    data?.aprsPasscode,
    data?.aprs_is_passcode,
    data?.aprsIsPasscode,
    data?.aprsis_passcode,
    data?.aprsisPasscode,
    user?.passcode,
    user?.aprs_passcode,
    user?.aprsPasscode,
    user?.aprs_is_passcode,
    user?.aprsIsPasscode,
    user?.aprsis_passcode,
    user?.aprsisPasscode
  );
  const patch = {};
  if (callsign) patch.callsign = call(callsign);
  if (passcode) patch.passcode = String(passcode).trim();
  return patch;
}

function memberLoginToken(data) {
  const user = data?.user || data?.member || data?.account || data?.profile || {};
  return firstValue(data?.token, data?.memberToken, data?.session_token, data?.sessionToken, user?.token, user?.memberToken, user?.session_token, user?.sessionToken);
}

function setMemberLoginState(kind, text) {
  const node = $('member-login-state');
  if (!node) return;
  node.className = `inline-state ${kind}`;
  node.textContent = text;
}

function setSaveState(kind, text) {
  const node = $('settings-save-state');
  if (!node) return;
  node.className = `inline-state ${kind}`;
  node.textContent = text;
}

async function verifyMemberLogin(options = {}) {
  const memberUser = clean($('set-member-user')?.value || state.settings.memberUser);
  const memberPass = $('set-member-pass')?.value || state.settings.memberPass;
  if (!memberUser || !memberPass) {
    if (!options.silent) setMemberLoginState('warn', 'Enter member user and password first');
    return false;
  }
  if (!options.silent) setMemberLoginState('warn', 'Checking member login...');
  const response = await api('/api/member/login', {
    method: 'POST',
    body: { callsign: memberUser, username: memberUser, password: memberPass }
  });
  const token = memberLoginToken(response.data || {});
  if (response.ok && token) {
    const autofill = memberLoginAutofillPatch(response.data);
    const patch = Object.assign({ memberUser, memberPass, memberToken: token }, autofill);
    state.settings = await window.aprsnet.saveSettings(patch);
    hydrateSettings();
    updatePreviews();
    authWebSocket();
    const filled = [autofill.callsign ? 'callsign' : '', autofill.passcode ? 'APRS-IS passcode' : ''].filter(Boolean);
    if (!options.silent) {
      setMemberLoginState('ok', filled.length ? `Member login OK; filled ${filled.join(' and ')}` : 'Member login OK; no callsign/passcode returned');
    }
    await loadMessages();
    return true;
  }
  if (!options.silent) setMemberLoginState('bad', response.error || 'Member login failed');
  return false;
}

function connectWebSocket() {
  if (state.ws) {
    state.ws.aprsnetManualClose = true;
    state.ws.close();
  }
  const socket = new WebSocket(state.server.ws);
  state.ws = socket;
  setPill('ws-state', 'warn', 'WS connecting');
  socket.addEventListener('open', () => {
    setPill('ws-state', 'ok', 'WS live');
    authWebSocket();
  });
  socket.addEventListener('close', () => {
    state.authed = false;
    if (socket.aprsnetManualClose) return;
    setPill('ws-state', 'bad', 'WS offline');
    setPill('auth-state', 'warn', 'RX only');
    setTimeout(connectWebSocket, 3000);
  });
  socket.addEventListener('error', () => {
    setPill('ws-state', 'bad', 'WS error');
  });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch (err) { return; }
    if (message.type === 'auth_ack') {
      state.authed = message.status === 'success';
      setPill('auth-state', state.authed ? 'ok' : 'warn', state.authed ? `TX ${message.callsign || state.settings.callsign}` : 'RX only');
      return;
    }
    if (['rx', 'obj', 'sys', 'alert', 'tx'].includes(message.type)) {
      const packet = message.packet || message.message || JSON.stringify(message);
      addPacket(packet, message.type);
      const parsed = parseAprsMessagePacket(packet, message.type === 'tx' ? 'out' : '');
      if (parsed) appendMessage(parsed);
    }
    if ((message.type === 'rx' || message.type === 'obj') && message.data) {
      const item = message.data;
      const stationCall = item.call || item.callsign;
      if (stationCall && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))) {
        state.stations.set(stationCall, { call: stationCall, lat: Number(item.lat), lon: Number(item.lon), ts: item.ts || Math.round(Date.now() / 1000), path: item.path || '', raw: item.raw || item.packet || '', symbol: item.symbol || '', type: message.type === 'obj' ? 'object' : 'station' });
        renderStations();
        renderWeatherStations();
        drawMap();
      }
    }
    if (message.type === 'msg_history' && message.data) {
      state.messages.unshift(...(Array.isArray(message.data) ? message.data : [message.data]));
      state.messages.sort((a, b) => (a.ts || 0) - (b.ts || 0));
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
  if (state.packets.some(item => item.packet === packet && item.type === type && Date.now() - item.ts < 10000)) return;
  state.packets.unshift({ packet, type, ts: Date.now() });
  state.packets = state.packets.slice(0, 150);
  state.packetTimes.push(Date.now());
  state.packetTimes = state.packetTimes.filter(ts => Date.now() - ts < 60000);
  $('metric-rate').textContent = `${state.packetTimes.length}/min`;
  renderPackets();
}

const APRS_SYMBOLS = {
  '/!': ['Police', '🚓'], '/#': ['Digipeater', '✳'], '/$': ['Phone', '☎'], '/%': ['DX cluster', 'DX'], '/&': ['HF gateway', 'GW'],
  "/'": ['Aircraft', '✈'], '/(': ['Satellite', '🛰'], '/)': ['Wheelchair', '♿'], '/*': ['Snowmobile', '❄'], '/+': ['Red Cross', '✚'],
  '/,': ['Scouts', '⚜'], '/-': ['House', '⌂'], '//': ['Waypoint', '•'], '/:': ['Fire', '🔥'], '/;': ['Campground', '⛺'],
  '/<': ['Motorcycle', '🏍'], '/=': ['Railroad', '🚆'], '/>': ['Car', '🚗'], '/?': ['Server', '?'], '/A': ['Aid station', '✚'],
  '/B': ['BBS', '▣'], '/C': ['Canoe', '🛶'], '/E': ['Eyeball', '◉'], '/F': ['Farm vehicle', '🚜'], '/H': ['Hotel', '▣'],
  '/I': ['TCP/IP', 'IP'], '/K': ['School', '⌂'], '/L': ['PC user', '💻'], '/N': ['NTS', 'N'], '/O': ['Balloon', '🎈'],
  '/P': ['Police', '🚓'], '/R': ['Recreational vehicle', 'RV'], '/S': ['Shuttle', '🚐'], '/U': ['Bus', '🚌'], '/W': ['NWS', 'WX'],
  '/X': ['Helicopter', '🚁'], '/Y': ['Yacht', '⛵'], '/[': ['Person', '👤'], '/\\': ['Triangle', '△'], '/]': ['Mail', '✉'],
  '/^': ['Aircraft', '✈'], '/_': ['Weather station', '☂'], '/`': ['Dish antenna', '◌'], '/a': ['Ambulance', '🚑'], '/b': ['Bike', '🚲'],
  '/c': ['Incident command', 'IC'], '/d': ['Fire department', 'FD'], '/f': ['Fire truck', '🚒'], '/g': ['Glider', '✈'], '/h': ['Hospital', 'H'],
  '/j': ['Jeep', '▣'], '/k': ['Truck', '🚚'], '/l': ['Laptop', '💻'], '/m': ['Repeater', 'R'], '/n': ['Node', '◎'],
  '/o': ['EOC', 'E'], '/r': ['Repeater', 'R'], '/s': ['Ship', '⛴'], '/t': ['Truck stop', '⛽'], '/u': ['Truck', '🚛'],
  '/v': ['Van', '🚐'], '/w': ['Water station', '💧'], '/x': ['Unix APRS', 'X'], '/y': ['Yagi', '⌁'],
  '\\!': ['Emergency', '!'], '\\#': ['Overlay digipeater', '✳'], '\\$': ['Bank', '$'], '\\%': ['Power plant', '⚡'], '\\&': ['Gateway', 'GW'],
  "\\'": ['Crash/incident', '⚠'], '\\(': ['Cloudy', '☁'], '\\)': ['Firenet', 'F'], '\\+': ['Church', '✝'], '\\,': ['Girl Scouts', '⚜'],
  '\\-': ['House', '⌂'], '\\.': ['Ambiguous', '?'], '\\/': ['Destination', '•'], '\\;': ['Park', '♣'], '\\<': ['Advisory', '⚑'],
  '\\>': ['Vehicle', '🚗'], '\\?': ['Info kiosk', '?'], '\\@': ['Hurricane', '🌀'], '\\A': ['Overlay box', '▣'], '\\C': ['Coast Guard', '⚓'],
  '\\D': ['Depot', 'D'], '\\E': ['Smoke', '☁'], '\\H': ['Haze', '☁'], '\\I': ['Rain shower', '☔'], '\\K': ['Kenwood HT', '▣'],
  '\\L': ['Lighthouse', '⌂'], '\\M': ['MARS', 'M'], '\\N': ['Buoy', '⚓'], '\\O': ['Rocket/balloon', '🚀'], '\\P': ['Parking', 'P'],
  '\\Q': ['Quake', '◈'], '\\R': ['Restaurant', '🍴'], '\\S': ['Satellite', '🛰'], '\\T': ['Thunderstorm', '⛈'], '\\U': ['Sunny', '☀'],
  '\\V': ['VORTAC', 'V'], '\\W': ['NWS site', 'WX'], '\\X': ['Pharmacy', 'Rx'], '\\Y': ['Radio/device', '📻'], '\\[': ['Wall cloud', '☁'],
  '\\\\': ['GPS symbol', '△'], '\\^': ['Aircraft', '✈'], '\\_': ['Weather site', '☂'], '\\`': ['Rain', '☔'], '\\a': ['ARES/Winlink', 'A'],
  '\\c': ['Civil defense', '△'], '\\d': ['DX spot', 'DX'], '\\e': ['Sleet', '☔'], '\\f': ['Funnel cloud', '🌪'], '\\g': ['Gale', '⚑'],
  '\\h': ['Store', '▣'], '\\i': ['Point of interest', 'i'], '\\j': ['Work zone', '⚒'], '\\k': ['Special vehicle', '▣'], '\\l': ['Area', '▢'],
  '\\m': ['Value sign', '▣'], '\\n': ['Overlay triangle', '△'], '\\o': ['Circle', '○'], '\\r': ['Restrooms', 'WC'], '\\s': ['Ship', '⛴'],
  '\\t': ['Tornado', '🌪'], '\\u': ['Truck', '🚛'], '\\v': ['Van', '🚐'], '\\w': ['Flooding', '≈'], '\\x': ['Wreck', '✕'],
  '\\y': ['Skywarn', '⚡'], '\\z': ['Shelter', '⌂']
};

function aprsSymbol(raw, supplied = '') {
  const compact = clean(supplied);
  if (compact.length >= 2) return { table: compact[0], code: compact[1], overlay: /^[0-9A-Za-z]$/.test(compact[0]) ? compact[0] : '' };
  const payload = String(raw || '').split(':').slice(1).join(':');
  if (!payload) return { table: '/', code: '>', overlay: '' };
  let table = '';
  let code = '';
  if ('!='.includes(payload[0]) && payload.length >= 20) {
    if (/[NS]/.test(payload[8]) && /[EW]/.test(payload[18])) {
      table = payload[9];
      code = payload[19];
    } else if (payload.length >= 11) {
      table = payload[1];
      code = payload[10];
    }
  } else if ('/@'.includes(payload[0]) && payload.length >= 27) {
    const offset = /[zZhH/]/.test(payload[7]) ? 7 : 8;
    if (/[NS]/.test(payload[offset + 8]) && /[EW]/.test(payload[offset + 18])) {
      table = payload[offset + 9];
      code = payload[offset + 19];
    } else if (payload.length >= offset + 11) {
      table = payload[offset + 1];
      code = payload[offset + 10];
    }
  } else if (payload[0] === ';' && payload.length >= 38) {
    table = payload[26];
    code = payload[36];
  }
  const overlay = /^[0-9A-Za-z]$/.test(table) ? table : '';
  return { table: table || '/', code: code || '>', overlay };
}

function aprsSymbolView(station) {
  const symbol = aprsSymbol(station.raw, station.symbol);
  const table = symbol.table === '\\' || symbol.overlay ? '\\' : '/';
  const key = `${table}${symbol.code}`;
  const base = APRS_SYMBOLS[key] || APRS_SYMBOLS[`/${symbol.code}`] || ['APRS station', symbol.code || '•'];
  return { key, label: base[0], glyph: base[1], overlay: symbol.overlay };
}

function renderPackets() {
  $('packet-feed').innerHTML = state.packets.map(item => `<div class="feed-row"><header><span>${esc(item.type)}</span><span>${new Date(item.ts).toLocaleTimeString()}</span></header><code>${esc(item.packet)}</code></div>`).join('') || '<div class="feed-row">Waiting for APRSNET packets...</div>';
}

function parseAprsMessagePacket(packet, direction = '') {
  const match = String(packet || '').match(/^([^>]+)>.*::(.{9}):(.*)$/);
  if (!match) return null;
  const from = call(match[1]);
  const to = call(match[2]);
  let text = match[3] || '';
  const idMatch = text.match(/\{([A-Za-z0-9]{1,5})$/);
  const id = idMatch ? idMatch[1] : '';
  if (idMatch) text = text.slice(0, -idMatch[0].length);
  const mine = baseCall(state.settings.callsign);
  return {
    id: `${from}-${to}-${id || text}-${Math.round(Date.now() / 1000)}`,
    from,
    to,
    text,
    ts: Math.round(Date.now() / 1000),
    direction: direction || (mine && baseCall(to) === mine ? 'in' : ''),
    raw: packet
  };
}

function normaliseMessage(item) {
  return {
    id: item.id || `${item.from || ''}-${item.to || ''}-${item.ts || Date.now()}-${item.text || item.packet || ''}`,
    from: call(item.from || item.src || ''),
    to: call(item.to || item.dst || ''),
    text: clean(item.text || item.message || item.packet || item.raw || ''),
    ts: Number(item.ts || item.timestamp || Math.round(Date.now() / 1000)),
    direction: item.direction || '',
    read: item.read !== false,
    raw: item.raw || item.packet || ''
  };
}

function mergeMessages(rows) {
  const merged = [];
  for (const row of rows.map(normaliseMessage).sort((a, b) => a.ts - b.ts)) {
    const duplicate = merged.some(existing =>
      existing.from === row.from &&
      existing.to === row.to &&
      existing.text === row.text &&
      Math.abs(existing.ts - row.ts) < 90
    );
    if (!duplicate) merged.push(row);
  }
  return merged.slice(-250);
}

function appendMessage(message) {
  state.messages = mergeMessages([...state.messages, message]);
  renderMessages();
}

function conversationPeer(message) {
  const mine = baseCall(state.settings.callsign);
  if (message.direction === 'out') return message.to || 'UNKNOWN';
  if (message.direction === 'in') return message.from || 'UNKNOWN';
  if (mine && baseCall(message.from) === mine) return message.to || 'UNKNOWN';
  if (mine && baseCall(message.to) === mine) return message.from || 'UNKNOWN';
  return message.from || message.to || 'UNKNOWN';
}

function groupedConversations() {
  const groups = new Map();
  state.messages.map(normaliseMessage).forEach(message => {
    const peer = conversationPeer(message);
    if (!groups.has(peer)) groups.set(peer, []);
    groups.get(peer).push(message);
  });
  return [...groups.entries()]
    .map(([peer, messages]) => ({ peer, messages: messages.sort((a, b) => a.ts - b.ts), last: messages[messages.length - 1] }))
    .sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));
}

function renderMessages() {
  const conversations = groupedConversations();
  if (!state.selectedConversation && conversations.length) state.selectedConversation = conversations[0].peer;
  $('conversation-list').innerHTML = conversations.map(conv => `
    <button class="conversation-item ${conv.peer === state.selectedConversation ? 'active' : ''}" data-conversation="${esc(conv.peer)}">
      <strong>${esc(conv.peer)}</strong>
      <span>${esc(conv.last?.text || 'No text')}</span>
      <span>${formatClock(conv.last?.ts)}</span>
    </button>
  `).join('') || '<div class="feed-row">No synced messages yet. Log in as a member to sync website history.</div>';

  const active = conversations.find(conv => conv.peer === state.selectedConversation);
  $('chat-title').textContent = active ? active.peer : 'Select a conversation';
  $('chat-subtitle').textContent = active ? `${active.messages.length} synced message${active.messages.length === 1 ? '' : 's'}` : 'Synced from APRSNET member message history where available.';
  $('message-feed').innerHTML = active
    ? active.messages.map(message => {
      const outgoing = message.direction === 'out' || (state.settings.callsign && baseCall(message.from) === baseCall(state.settings.callsign));
      return `<div class="bubble ${outgoing ? 'out' : 'in'}"><div>${esc(message.text)}</div><div class="bubble-meta">${esc(message.from || '?')} to ${esc(message.to || '?')} - ${formatClock(message.ts)}</div></div>`;
    }).join('')
    : '<div class="bubble system">Choose a conversation on the left.</div>';
  $('message-feed').scrollTop = $('message-feed').scrollHeight;
}

function renderStations() {
  const rows = [...state.stations.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('metric-stations').textContent = rows.length;
  $('metric-objects').textContent = `${rows.filter(row => row.type === 'object').length} objects`;
  $('station-table').innerHTML = rows.slice(0, 90).map(row => `<tr><td><button class="call-button" data-call="${esc(row.call)}">${esc(row.call)}</button></td><td>${age(row.ts)}</td><td>${row.lat.toFixed(4)}, ${row.lon.toFixed(4)}</td><td><code>${esc(row.path || '-')}</code></td></tr>`).join('');
}

function parseWXPacket(raw) {
  if (!raw) return null;
  const colon = raw.indexOf(':');
  if (colon < 0) return null;
  const payload = raw.slice(colon + 1);
  if (!/[tcbshgrpLl]\d{2,5}/.test(payload)) return null;
  const wx = {};
  const temp = payload.match(/t([-+]?\d{2,3})/);
  if (temp && temp[1] !== '...') wx.tempC = Math.round((parseInt(temp[1], 10) - 32) * 5 / 9);
  const humidity = payload.match(/h(\d{2})/);
  if (humidity) wx.humidity = parseInt(humidity[1], 10) === 0 ? 100 : parseInt(humidity[1], 10);
  const pressure = payload.match(/b(\d{5})/);
  if (pressure) wx.pressure = (parseInt(pressure[1], 10) / 10).toFixed(1);
  const windDir = payload.match(/c(\d{3})/);
  if (windDir && windDir[1] !== '...') wx.windDir = parseInt(windDir[1], 10);
  const windSpd = payload.match(/s(\d{3})/);
  if (windSpd && windSpd[1] !== '...') wx.windSpd = Math.round(parseInt(windSpd[1], 10) * 1.60934);
  const nativeWind = payload.match(/(?:^|_)(\d{3})\/(\d{3})/);
  if (nativeWind && wx.windDir === undefined) wx.windDir = parseInt(nativeWind[1], 10);
  if (nativeWind && wx.windSpd === undefined) wx.windSpd = Math.round(parseInt(nativeWind[2], 10) * 1.60934);
  const gust = payload.match(/g(\d{3})/);
  if (gust && gust[1] !== '...') wx.windGust = Math.round(parseInt(gust[1], 10) * 1.60934);
  const rain1h = payload.match(/r(\d{3})/);
  if (rain1h) wx.rain1h = (parseInt(rain1h[1], 10) * 0.254).toFixed(1);
  const rain24h = payload.match(/p(\d{3})/);
  if (rain24h) wx.rain24h = (parseInt(rain24h[1], 10) * 0.254).toFixed(1);
  const luminosity = payload.match(/[Ll](\d{3,4})/);
  if (luminosity) wx.luminosity = parseInt(luminosity[1], 10);
  return Object.keys(wx).length ? wx : null;
}

function windLabel(deg) {
  if (!Number.isFinite(Number(deg))) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(Number(deg) / 45) % 8];
}

async function ensureUserLocation() {
  if (userLocation()) return userLocation();
  if (!navigator.geolocation) return null;
  try {
    const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 300000 }));
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    await window.aprsnet.reportPosition({ lat, lon, accuracy: pos.coords.accuracy });
    state.userLocation = { lat, lon, source: 'current device location' };
    state.settings.manualLat = state.settings.manualLat ?? null;
    state.settings.manualLon = state.settings.manualLon ?? null;
    return state.userLocation;
  } catch (err) {
    return null;
  }
}

function weatherStations() {
  const origin = userLocation();
  return [...state.stations.values()]
    .map(station => ({ station, wx: parseWXPacket(station.raw) }))
    .filter(row => row.wx && Number.isFinite(row.station.lat) && Number.isFinite(row.station.lon))
    .map(row => Object.assign(row, {
      distance: origin ? distanceKm(origin.lat, origin.lon, row.station.lat, row.station.lon) : null
    }))
    .sort((a, b) => {
      if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
      return (b.station.ts || 0) - (a.station.ts || 0);
    });
}

function renderWeatherStations() {
  const origin = userLocation();
  const stations = weatherStations();
  const nearest = stations.slice(0, 6);
  $('weather-origin').textContent = origin
    ? `Nearest stations to ${origin.source}: ${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)}`
    : 'No user location yet. Add manual lat/lon in Settings or allow location access; showing freshest APRS weather stations.';
  const temps = stations.map(s => s.wx.tempC).filter(Number.isFinite);
  const winds = stations.map(s => s.wx.windSpd).filter(Number.isFinite);
  const hums = stations.map(s => s.wx.humidity).filter(Number.isFinite);
  const avg = list => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : '-';
  $('weather-summary').innerHTML = `
    <article><span>Weather Stations</span><strong>${stations.length}</strong><em>heard on APRS</em></article>
    <article><span>Avg Temp</span><strong>${avg(temps)}${temps.length ? 'C' : ''}</strong><em>nearby sample</em></article>
    <article><span>Max Wind</span><strong>${winds.length ? Math.max(...winds) + ' km/h' : '-'}</strong><em>${winds.length ? Math.round(Math.max(...winds) * 0.621371) + ' mph' : 'no wind data'}</em></article>
    <article><span>Avg Humidity</span><strong>${avg(hums)}${hums.length ? '%' : ''}</strong><em>reported humidity</em></article>
  `;
  $('weather-grid').innerHTML = nearest.length ? nearest.map(({ station, wx, distance }) => `
    <article class="wx-card">
      <strong><button class="call-button" data-call="${esc(station.call)}">${esc(station.call)}</button></strong>
      <p>${distance !== null ? `${distance.toFixed(1)} km away - ` : ''}heard ${age(station.ts)} ago</p>
      ${wx.tempC !== undefined ? `<div class="wx-temp">${wx.tempC}C <span>(${Math.round(wx.tempC * 9 / 5 + 32)}F)</span></div>` : ''}
      ${wx.humidity !== undefined ? `<div class="wx-row"><span>Humidity</span><b>${wx.humidity}%</b></div>` : ''}
      ${wx.pressure !== undefined ? `<div class="wx-row"><span>Pressure</span><b>${wx.pressure} hPa</b></div>` : ''}
      ${wx.windSpd !== undefined ? `<div class="wx-row"><span>Wind ${windLabel(wx.windDir)} ${wx.windDir ?? ''}</span><b>${Math.round(wx.windSpd * 0.621371)} mph (${wx.windSpd} km/h)</b></div>` : ''}
      ${wx.windGust !== undefined ? `<div class="wx-row"><span>Gust</span><b>${Math.round(wx.windGust * 0.621371)} mph (${wx.windGust} km/h)</b></div>` : ''}
      ${wx.rain1h !== undefined ? `<div class="wx-row"><span>Rain 1h</span><b>${wx.rain1h} mm</b></div>` : ''}
      ${wx.rain24h !== undefined ? `<div class="wx-row"><span>Rain 24h</span><b>${wx.rain24h} mm</b></div>` : ''}
    </article>
  `).join('') : '<article><strong>No APRS weather stations found</strong><p>Waiting for CWOP/WX packets in APRSNET station data.</p></article>';
}

function renderAnalytics(data) {
  const generated = data.generated_at ? new Date(Number(data.generated_at) * 1000).toLocaleString() : '-';
  const heatmap = Array.isArray(data.heatmap) ? data.heatmap : [];
  const maxHeat = Math.max(1, ...heatmap.flat().map(Number));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const heatHtml = heatmap.length ? heatmap.map((row, idx) => {
    const day = days[idx] || `D${idx + 1}`;
    return `<div class="heatmap-row"><span>${day}</span>${row.slice(0, 24).map((v, hour) => {
      const alpha = Number(v) ? (0.2 + Number(v) / maxHeat * 0.8).toFixed(2) : '0.08';
      return `<span class="heatmap-cell" title="${day} ${hour}:00 - ${v} packets" style="background:rgba(39,217,154,${alpha})"></span>`;
    }).join('')}</div>`;
  }).join('') : '<p>No heatmap data returned.</p>';
  const gradeColor = grade => ({ A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', E: '#ef4444', F: '#991b1b' }[grade] || '#64748b');
  const reliability = (data.reliability || []).slice(0, 10).map(row => `
    <div class="rank-row"><span class="grade" style="background:${gradeColor(row.grade)}">${esc(row.grade || '-')}</span><div><strong>${esc(row.callsign)}</strong><p>${row.packets || 0} packets, score ${row.score ?? '-'}</p></div><span>${row.avg_gap_s ? Math.round(row.avg_gap_s / 60) + 'm gap' : ''}</span></div>
  `).join('') || '<p>No reliability data returned.</p>';
  const paths = (data.longest_paths || []).slice(0, 8).map((row, index) => `
    <div class="rank-row"><span>#${index + 1}</span><div><strong>${esc(row.callsign)}</strong><p>${esc(row.path || '')}</p></div><span>${row.hops || 0} hops</span></div>
  `).join('') || '<p>No long path data returned.</p>';
  $('analytics-grid').innerHTML = `
    <div class="analytics-summary">
      <article><span>Total Packets</span><strong>${Number(data.total_packets || 0).toLocaleString()}</strong><em>in analysis window</em></article>
      <article><span>Total Stations</span><strong>${Number(data.total_stations || 0).toLocaleString()}</strong><em>unique stations</em></article>
      <article><span>Busiest Hour</span><strong>${data.best_hour ?? '-'}</strong><em>${Number(data.best_hour_count || 0).toLocaleString()} packets</em></article>
      <article><span>Generated</span><strong>${esc(generated)}</strong><em>server analytics time</em></article>
    </div>
    <section class="analytics-section"><h2>Activity Heatmap</h2><div class="heatmap">${heatHtml}</div></section>
    <section class="analytics-section"><h2>Most Reliable Stations</h2><div class="rank-list">${reliability}</div></section>
    <section class="analytics-section"><h2>Longest Heard Paths</h2><div class="rank-list">${paths}</div></section>
  `;
}

function lonToTileX(lon, zoom) { return ((lon + 180) / 360) * 2 ** zoom; }
function latToTileY(lat, zoom) {
  const rad = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** zoom;
}
function tileXToLon(x, zoom) { return x / 2 ** zoom * 360 - 180; }
function tileYToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / 2 ** zoom;
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function project(lat, lon, zoom) {
  return { x: lonToTileX(lon, zoom) * 256, y: latToTileY(lat, zoom) * 256 };
}

function setMapCenterFromPixels(pixelX, pixelY, zoom) {
  state.map.lon = tileXToLon(pixelX / 256, zoom);
  state.map.lat = tileYToLat(pixelY / 256, zoom);
}

function zoomMap(delta, anchorEvent = null) {
  const map = $('map');
  if (!map || !map.clientWidth || !map.clientHeight) return;
  const oldZoom = Math.max(2, Math.min(18, state.map.zoom));
  const newZoom = Math.max(2, Math.min(18, oldZoom + delta));
  if (newZoom === oldZoom) return;
  const rect = map.getBoundingClientRect();
  const anchorX = anchorEvent ? anchorEvent.clientX - rect.left : map.clientWidth / 2;
  const anchorY = anchorEvent ? anchorEvent.clientY - rect.top : map.clientHeight / 2;
  const oldCenter = project(state.map.lat, state.map.lon, oldZoom);
  const oldAnchorWorld = {
    x: oldCenter.x - map.clientWidth / 2 + anchorX,
    y: oldCenter.y - map.clientHeight / 2 + anchorY
  };
  const scale = 2 ** (newZoom - oldZoom);
  const newCenter = {
    x: oldAnchorWorld.x * scale - anchorX + map.clientWidth / 2,
    y: oldAnchorWorld.y * scale - anchorY + map.clientHeight / 2
  };
  state.map.zoom = newZoom;
  setMapCenterFromPixels(newCenter.x, newCenter.y, newZoom);
  drawMap();
}

function fitMapToStations() {
  const stations = [...state.stations.values()].filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (!stations.length) return;
  const minLat = Math.min(...stations.map(s => s.lat));
  const maxLat = Math.max(...stations.map(s => s.lat));
  const minLon = Math.min(...stations.map(s => s.lon));
  const maxLon = Math.max(...stations.map(s => s.lon));
  state.map.lat = (minLat + maxLat) / 2;
  state.map.lon = (minLon + maxLon) / 2;
  const map = $('map');
  if (!map.clientWidth || !map.clientHeight) return;
  const latSpan = Math.max(0.01, maxLat - minLat);
  const lonSpan = Math.max(0.01, maxLon - minLon);
  let zoom = 3;
  for (let z = 3; z <= 15; z++) {
    const px1 = project(minLat, minLon, z);
    const px2 = project(maxLat, maxLon, z);
    if (Math.abs(px2.x - px1.x) < map.clientWidth * 0.8 && Math.abs(px2.y - px1.y) < map.clientHeight * 0.8) zoom = z;
  }
  if (latSpan < 0.1 && lonSpan < 0.1) zoom = Math.max(zoom, 10);
  state.map.zoom = zoom;
  drawMap();
}

function drawMap() {
  if (state.map.frame) cancelAnimationFrame(state.map.frame);
  state.map.frame = requestAnimationFrame(renderMap);
}

function markerParts(marker) {
  if (!marker.aprsnetParts) {
    marker.aprsnetParts = {
      symbol: marker.querySelector('.map-symbol'),
      overlay: marker.querySelector('.map-overlay'),
      label: marker.querySelector('.map-label')
    };
  }
  return marker.aprsnetParts;
}

function markerNode(key) {
  let marker = state.map.markerNodes.get(key);
  if (!marker) {
    marker = document.createElement('button');
    marker.className = 'map-marker';
    marker.dataset.marker = key;
    marker.type = 'button';
    marker.innerHTML = '<span class="map-symbol"></span><span class="map-overlay"></span><span class="map-label"></span>';
    state.map.markerNodes.set(key, marker);
  }
  return marker;
}

function updateClusterMarker(marker, cluster) {
  marker.className = 'map-marker cluster';
  delete marker.dataset.call;
  marker.dataset.cluster = 'true';
  marker.title = `${cluster.count} APRS stations near this area. Zoom in for individual stations.`;
  marker.style.transform = `translate(${Math.round(cluster.x)}px, ${Math.round(cluster.y)}px) translate(-50%, -50%)`;
  const parts = markerParts(marker);
  parts.symbol.textContent = cluster.count > 99 ? '99+' : String(cluster.count);
  parts.overlay.textContent = '';
  parts.label.textContent = `${cluster.count} stations`;
}

function updateStationMarker(marker, station, x, y, watch) {
  marker.dataset.call = station.call;
  delete marker.dataset.cluster;
  const isWx = !!parseWXPacket(station.raw);
  const view = aprsSymbolView(station);
  marker.className = ['map-marker', station.type === 'object' ? 'object' : '', watch.has(station.call.toUpperCase()) ? 'watch' : '', isWx ? 'wx' : ''].filter(Boolean).join(' ');
  marker.title = `${station.call} - ${view.label} (${view.key})`;
  marker.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  const parts = markerParts(marker);
  parts.symbol.textContent = view.glyph;
  parts.overlay.textContent = view.overlay;
  parts.label.textContent = station.call;
}

function renderMap() {
  state.map.frame = null;
  const map = $('map');
  const tiles = $('map-tiles');
  const markers = $('map-markers');
  if (!map || !tiles || !markers || !map.clientWidth || !map.clientHeight) return;
  const zoom = Math.max(2, Math.min(18, state.map.zoom));
  const center = project(state.map.lat, state.map.lon, zoom);
  const left = center.x - map.clientWidth / 2;
  const top = center.y - map.clientHeight / 2;
  const minX = Math.floor(left / 256) - 1;
  const maxX = Math.floor((left + map.clientWidth) / 256) + 1;
  const minY = Math.floor(top / 256) - 1;
  const maxY = Math.floor((top + map.clientHeight) / 256) + 1;
  const maxTile = 2 ** zoom;
  const activeTiles = new Set();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (y < 0 || y >= maxTile) continue;
      const wrappedX = ((x % maxTile) + maxTile) % maxTile;
      const key = `${zoom}:${wrappedX}:${y}:${x}`;
      activeTiles.add(key);
      let tile = state.map.tileNodes.get(key);
      if (!tile) {
        tile = document.createElement('img');
        tile.alt = '';
        tile.draggable = false;
        tile.dataset.tile = key;
        tile.src = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
        tiles.appendChild(tile);
        state.map.tileNodes.set(key, tile);
      }
      tile.style.transform = `translate(${Math.round(x * 256 - left)}px, ${Math.round(y * 256 - top)}px)`;
    }
  }
  state.map.tileNodes.forEach((tile, key) => {
    if (!activeTiles.has(key)) {
      tile.remove();
      state.map.tileNodes.delete(key);
    }
  });

  const watch = new Set(clean($('watchlist').value).toUpperCase().split(/[,\s]+/).filter(Boolean));
  const activeMarkers = new Set();
  const visibleStations = [];
  const visibleClusters = new Map();
  for (const station of state.stations.values()) {
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;
    const point = project(station.lat, station.lon, zoom);
    const x = Math.round(point.x - left);
    const y = Math.round(point.y - top);
    if (x < -90 || y < -50 || x > map.clientWidth + 120 || y > map.clientHeight + 60) continue;
    if (zoom < CLUSTER_ZOOM_LIMIT && !watch.has(station.call.toUpperCase())) {
      const cellX = Math.floor(x / CLUSTER_CELL_SIZE);
      const cellY = Math.floor(y / CLUSTER_CELL_SIZE);
      const key = `cluster:${cellX}:${cellY}`;
      const cluster = visibleClusters.get(key) || { key, call: station.call, count: 0, x: 0, y: 0, newest: 0 };
      cluster.count += 1;
      cluster.x += x;
      cluster.y += y;
      if ((station.ts || 0) > cluster.newest) {
        cluster.call = station.call;
        cluster.newest = station.ts || 0;
      }
      visibleClusters.set(key, cluster);
      continue;
    }
    visibleStations.push({ station, x, y });
  }

  let rendered = 0;
  const fragment = document.createDocumentFragment();
  for (const cluster of visibleClusters.values()) {
    if (cluster.count === 1) continue;
    cluster.x /= cluster.count;
    cluster.y /= cluster.count;
    activeMarkers.add(cluster.key);
    const marker = markerNode(cluster.key);
    updateClusterMarker(marker, cluster);
    if (!marker.parentNode) fragment.appendChild(marker);
    rendered += 1;
  }

  const clusterSingles = [];
  for (const cluster of visibleClusters.values()) {
    if (cluster.count !== 1) continue;
    const station = state.stations.get(cluster.call);
    if (!station) continue;
    clusterSingles.push({ station, x: Math.round(cluster.x), y: Math.round(cluster.y) });
  }

  for (const item of visibleStations.concat(clusterSingles).sort((a, b) => (b.station.ts || 0) - (a.station.ts || 0)).slice(0, MAX_VISIBLE_MARKERS)) {
    const { station, x, y } = item;
    const key = `station:${station.call}`;
    activeMarkers.add(key);
    const marker = markerNode(key);
    updateStationMarker(marker, station, x, y, watch);
    if (!marker.parentNode) fragment.appendChild(marker);
    rendered += 1;
  }
  if (fragment.childNodes.length) markers.appendChild(fragment);
  state.map.markerNodes.forEach((marker, key) => {
    if (!activeMarkers.has(key)) {
      marker.remove();
      state.map.markerNodes.delete(key);
    }
  });
  $('map-attribution').textContent = `${rendered.toLocaleString()} shown / ${state.stations.size.toLocaleString()} heard - OpenStreetMap`;
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
  return packet;
}

function transmitMessage() {
  const packet = transmit(messagePacket);
  if (!packet) return;
  appendMessage({
    from: source(),
    to: call($('message-to').value),
    text: clean($('message-text').value).slice(0, 67),
    ts: Math.round(Date.now() / 1000),
    direction: 'out',
    raw: packet
  });
  $('message-text').value = '';
  const nextId = Number($('message-id').value);
  if (Number.isFinite(nextId)) $('message-id').value = String((nextId % 99) + 1).padStart(2, '0');
  updatePreviews();
}

async function saveSettings() {
  setSaveState('warn', 'Saving settings...');
  const memberUser = clean($('set-member-user').value);
  const memberPass = $('set-member-pass').value;
  const oldCall = call(state.settings.callsign);
  const oldPass = clean(state.settings.passcode);
  const memberChanged = memberUser !== clean(state.settings.memberUser) || memberPass !== (state.settings.memberPass || '');
  const patch = {
    memberUser: clean($('set-member-user').value),
    memberPass: $('set-member-pass').value,
    callsign: call($('set-callsign').value),
    passcode: clean($('set-passcode').value),
    manualLat: clean($('set-lat').value) === '' ? null : Number($('set-lat').value),
    manualLon: clean($('set-lon').value) === '' ? null : Number($('set-lon').value),
    notifications: $('set-notifications').checked,
    minimizeToTray: $('set-tray').checked,
    launchOnStartup: $('set-startup').checked,
    watchlist: $('watchlist').value
  };
  try {
    state.settings = await window.aprsnet.saveSettings(patch);
    let verified = false;
    if (memberChanged && memberUser && memberPass) verified = await verifyMemberLogin({ silent: false });
    const txChanged = oldCall !== call(state.settings.callsign) || oldPass !== clean(state.settings.passcode);
    if (txChanged) connectWebSocket(); else authWebSocket();
    updatePreviews();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setSaveState('ok', verified ? `Saved and member login verified at ${timestamp}` : `Settings saved at ${timestamp}`);
  } catch (err) {
    setSaveState('bad', `Save failed: ${err.message || err}`);
  }
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
    map: ['Tactical Map', 'Zoomable OpenStreetMap station plot fed by APRSNET GeoJSON and WebSocket updates.'],
    messages: ['Messages', 'Synced APRSNET message history with chat bubbles and authenticated APRS transmit.'],
    transmit: ['Transmit', 'Build and preview APRS messages, beacons, objects and raw packets.'],
    weather: ['Weather', 'Nearest APRS weather stations from APRSNET using your saved or device location.'],
    analytics: ['Analytics', 'Network, propagation and activity analytics from APRSNET.'],
    settings: ['Settings', 'Credentials, position and desktop integration.']
  }[name];
  $('view-title').textContent = copy[0];
  $('view-copy').textContent = copy[1];
  if (name === 'map') setTimeout(drawMap, 50);
}

async function refreshAll() {
  await Promise.all([loadStatus(), loadMessages(), loadAnalytics()]);
  await loadStations();
  await loadWeather();
}

async function init() {
  state.settings = await window.aprsnet.getSettings();
  state.server = await window.aprsnet.getServer();
  $('app-version').textContent = `v${await window.aprsnet.getVersion()}`;
  hydrateSettings();
  updatePreviews();

  document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.querySelectorAll('input, textarea').forEach(node => node.addEventListener('input', updatePreviews));
  document.addEventListener('click', event => {
    if (state.map.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const conv = event.target.closest('[data-conversation]');
    if (conv) {
      state.selectedConversation = conv.dataset.conversation;
      $('message-to').value = state.selectedConversation;
      renderMessages();
      updatePreviews();
      return;
    }
    const cluster = event.target.closest('.map-marker[data-cluster]');
    if (cluster) {
      zoomMap(1, event);
      return;
    }
    const button = event.target.closest('.call-button[data-call], .map-marker[data-call]');
    if (!button) return;
    $('message-to').value = button.dataset.call;
    state.selectedConversation = button.dataset.call;
    switchView('messages');
    renderMessages();
    updatePreviews();
  });

  $('open-site').addEventListener('click', () => window.aprsnet.openExternal(state.server.url));
  $('refresh-now').addEventListener('click', refreshAll);
  $('refresh-messages').addEventListener('click', loadMessages);
  $('refresh-weather').addEventListener('click', loadWeather);
  $('refresh-analytics').addEventListener('click', loadAnalytics);
  $('clear-packets').addEventListener('click', () => { state.packets = []; renderPackets(); });
  $('fit-map').addEventListener('click', fitMapToStations);
  $('map-zoom-in').addEventListener('click', () => zoomMap(1));
  $('map-zoom-out').addEventListener('click', () => zoomMap(-1));
  $('watchlist').addEventListener('change', async () => {
    state.settings = await window.aprsnet.saveSettings({ watchlist: $('watchlist').value });
    drawMap();
  });
  $('map').addEventListener('wheel', event => {
    event.preventDefault();
    zoomMap(event.deltaY < 0 ? 1 : -1, event);
  }, { passive: false });
  $('map').addEventListener('mousedown', event => {
    if (event.target.closest('.map-controls, input, textarea')) return;
    const center = project(state.map.lat, state.map.lon, state.map.zoom);
    state.map.dragging = true;
    state.map.dragMoved = false;
    state.map.dragStart = { x: event.clientX, y: event.clientY };
    state.map.dragCenter = center;
    $('map').classList.add('dragging');
  });
  window.addEventListener('mousemove', event => {
    if (!state.map.dragging) return;
    const dx = event.clientX - state.map.dragStart.x;
    const dy = event.clientY - state.map.dragStart.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) state.map.dragMoved = true;
    setMapCenterFromPixels(state.map.dragCenter.x - dx, state.map.dragCenter.y - dy, state.map.zoom);
    const now = performance.now();
    if (now - state.map.lastDragDraw > 32) {
      state.map.lastDragDraw = now;
      drawMap();
    }
  });
  window.addEventListener('mouseup', () => {
    if (state.map.dragging && state.map.dragMoved) {
      state.map.suppressClick = true;
      setTimeout(() => { state.map.suppressClick = false; }, 0);
    }
    state.map.dragging = false;
    $('map').classList.remove('dragging');
    drawMap();
  });
  window.addEventListener('resize', drawMap);
  $('send-message').addEventListener('click', transmitMessage);
  $('send-beacon').addEventListener('click', () => transmit(beaconPacket));
  $('send-object').addEventListener('click', () => transmit(objectPacket));
  $('send-raw').addEventListener('click', () => transmit(rawPacket));
  $('save-settings').addEventListener('click', saveSettings);
  $('verify-member').addEventListener('click', () => verifyMemberLogin({ silent: false }));
  $('use-position').addEventListener('click', async () => {
    const position = await window.aprsnet.getPosition();
    if (!position) return;
    $('beacon-lat').value = position.lat;
    $('beacon-lon').value = position.lon;
    updatePreviews();
  });

  connectWebSocket();
  await loginMember();
  await refreshAll();
  setInterval(loadStatus, 15000);
  setInterval(loadStations, 60000);
  setInterval(loadMessages, 45000);
}

window.addEventListener('load', init);
