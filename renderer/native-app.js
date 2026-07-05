let SERVER = "https://www.aprsnet.uk";
let WS = "wss://www.aprsnet.uk/ws";

const state = {
  settings: {},
  ws: null,
  authed: false,
  stations: new Map(),
  messages: [],
  packets: [],
  packetTimes: [],
};

const $ = (id) => document.getElementById(id);

function cleanCall(v) { return String(v || "").trim().toUpperCase(); }
function baseCall(v) { return cleanCall(v).split("-")[0]; }
function esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function age(ts) {
  if (!ts) return "-";
  const s = Math.max(0, Math.round(Date.now() / 1000 - Number(ts)));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}
function time() { return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

async function api(path, options = {}) {
  return window.aprsClient.apiRequest({ path, method: options.method || "GET", body: options.body, headers: options.headers });
}

function setPill(id, kind, text) {
  const node = $(id);
  node.className = `pill ${kind}`;
  node.textContent = text;
}

function encodeCoord(lat, lon) {
  if (String(lat).trim() === "" || String(lon).trim() === "") throw new Error("Latitude and longitude are required.");
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) throw new Error("Invalid coordinates.");
  const latAbs = Math.abs(la), lonAbs = Math.abs(lo);
  const latDeg = Math.floor(latAbs), lonDeg = Math.floor(lonAbs);
  let latMin = Math.round(((latAbs - latDeg) * 60) * 100) / 100;
  let lonMin = Math.round(((lonAbs - lonDeg) * 60) * 100) / 100;
  if (latMin >= 60) latMin = 59.99;
  if (lonMin >= 60) lonMin = 59.99;
  return `${String(latDeg).padStart(2, "0")}${latMin.toFixed(2).padStart(5, "0")}${la >= 0 ? "N" : "S"}/${String(lonDeg).padStart(3, "0")}${lonMin.toFixed(2).padStart(5, "0")}${lo >= 0 ? "E" : "W"}`;
}

function source(ssid = "") {
  const configured = cleanCall(state.settings.callsign);
  const call = configured || baseCall(state.settings.callsign);
  const suffix = String(ssid || "").trim();
  return suffix ? `${baseCall(call)}-${suffix.replace(/^-/, "")}` : call;
}

function msgPacket() {
  const to = cleanCall($("msg-to").value);
  const text = $("msg-text").value.trim().slice(0, 67);
  const id = $("msg-id").value.trim().slice(0, 5);
  if (!to || !text) throw new Error("Message destination and text are required.");
  return `${source()}>APRS,TCPIP*::${to.padEnd(9, " ").slice(0, 9)}:${text}${id ? `{${id}` : ""}`;
}

function beaconPacket() {
  const ssid = $("beacon-ssid").value.trim() || "9";
  if (!/^(1[0-5]|[0-9])$/.test(ssid)) throw new Error("SSID must be 0-15.");
  return `${source(ssid)}>APRS,TCPIP*:=` + `${encodeCoord($("beacon-lat").value, $("beacon-lon").value)}>${$("beacon-comment").value.trim().slice(0, 43)}`;
}

function objectPacket() {
  const name = $("object-name").value.trim().toUpperCase().padEnd(9, " ").slice(0, 9);
  if (!name.trim()) throw new Error("Object name is required.");
  const d = new Date();
  const stamp = `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}z`;
  return `${source()}>APRS,TCPIP*:;${name}*${stamp}${encodeCoord($("object-lat").value, $("object-lon").value)}O${$("object-comment").value.trim().slice(0, 36)}`;
}

function rawPacket() {
  const packet = $("raw-packet").value.trim();
  if (!packet.includes(">")) throw new Error("Raw packet needs a source and path.");
  if (baseCall(packet.split(">")[0]) !== baseCall(state.settings.callsign)) throw new Error("Raw packet source must match your callsign.");
  return packet;
}

function updatePreviews() {
  for (const [id, fn] of [["message-preview", msgPacket], ["beacon-preview", beaconPacket], ["object-preview", objectPacket]]) {
    try { $(id).textContent = fn(); } catch (e) { $(id).textContent = e.message; }
  }
}

async function loadStatus() {
  const res = await api("/api/status");
  if (!res.ok) return;
  const s = res.data;
  $("pkts-rx").textContent = Number(s.pkts_rx || 0).toLocaleString();
  $("client-count").textContent = (s.clients || []).length;
  $("tcp-count").textContent = `${s.tcp_clients || 0} TCP`;
  $("uptime").textContent = s.uptime || "-";
  $("ring").textContent = `ring ${s.ring_size || 0}`;
  setPill("upstream-pill", s.upstream_connected ? "ok" : "bad", s.upstream_connected ? "Upstream online" : "Upstream offline");
}

async function loadStations() {
  const res = await api("/api/export/geojson");
  if (!res.ok || !res.data?.features) return;
  for (const f of res.data.features) {
    const coords = f.geometry?.coordinates || [];
    const p = f.properties || {};
    const call = p.callsign || p.name;
    if (!call || coords.length < 2) continue;
    state.stations.set(call, { call, lon: coords[0], lat: coords[1], ts: p.timestamp, path: p.path || "", type: p.type || "station" });
  }
  renderStations();
  drawMap();
}

async function loadMessages() {
  const res = await api("/api/messages");
  if (!res.ok || !Array.isArray(res.data)) return;
  state.messages = res.data.slice(-80).reverse();
  renderMessages();
}

async function memberLogin() {
  if (!state.settings.memberUser || !state.settings.memberPass || !state.settings.autoMemberLogin) return;
  const res = await api("/api/member/login", {
    method: "POST",
    body: { callsign: state.settings.memberUser, password: state.settings.memberPass },
  });
  if (res.ok && res.data?.token) {
    state.settings = await window.aprsClient.saveSettings({ memberToken: res.data.token });
    return res.data;
  }
  return null;
}

async function loadWeather() {
  const res = await api("/api/wx/warnings");
  const grid = $("weather-grid");
  if (!res.ok) { grid.innerHTML = `<div class="card">Weather warnings unavailable</div>`; return; }
  const items = Array.isArray(res.data) ? res.data : (res.data?.warnings || []);
  grid.innerHTML = items.length ? items.map(w => `<article class="card"><strong>${esc(w.headline || w.event || "Warning")}</strong><p>${esc(w.description || w.area || JSON.stringify(w).slice(0, 180))}</p></article>`).join("") : `<div class="card">No active warning data returned.</div>`;
}

async function loadAnalytics() {
  const res = await api("/api/analytics");
  const grid = $("analytics-grid");
  if (!res.ok) { grid.innerHTML = `<div class="card">Analytics unavailable</div>`; return; }
  grid.innerHTML = Object.entries(res.data || {}).slice(0, 12).map(([k, v]) => `<article class="card"><strong>${esc(k)}</strong><p>${esc(typeof v === "object" ? JSON.stringify(v).slice(0, 220) : v)}</p></article>`).join("");
}

function connectWS() {
  state.ws = new WebSocket(WS);
  setPill("ws-pill", "warn", "WS connecting");
  state.ws.addEventListener("open", () => {
    setPill("ws-pill", "ok", "WS live");
    authWS();
  });
  state.ws.addEventListener("close", () => {
    state.authed = false;
    setPill("ws-pill", "bad", "WS offline");
    setPill("auth-pill", "warn", "RX only");
    setTimeout(connectWS, 2500);
  });
  state.ws.addEventListener("message", ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "auth_ack") {
      state.authed = msg.status === "success";
      setPill("auth-pill", state.authed ? "ok" : "warn", state.authed ? `TX ${msg.callsign || state.settings.callsign}` : "RX only");
      return;
    }
    if (["rx", "obj", "sys", "alert"].includes(msg.type)) addPacket(msg.packet || msg.message || JSON.stringify(msg), msg.type);
    if ((msg.type === "rx" || msg.type === "obj") && msg.data) {
      const d = msg.data;
      const call = d.call || d.callsign;
      if (call && Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon))) {
        state.stations.set(call, { call, lat: Number(d.lat), lon: Number(d.lon), ts: d.ts || Math.round(Date.now() / 1000), path: d.path || "", type: msg.type === "obj" ? "object" : "station" });
        renderStations();
        drawMap();
      }
    }
    if (msg.type === "msg_history" && msg.data) {
      if (Array.isArray(msg.data)) state.messages.unshift(...msg.data);
      else state.messages.unshift(msg.data);
      renderMessages();
    }
  });
}

function authWS() {
  if (!state.settings.callsign || !state.settings.passcode || state.ws?.readyState !== WebSocket.OPEN) return;
  state.ws.send(JSON.stringify({ type: "auth", callsign: baseCall(state.settings.callsign), passcode: state.settings.passcode, software: "APRS Client Desktop Native" }));
}

function addPacket(packet, type) {
  state.packets.unshift({ packet, type, ts: Date.now() });
  state.packets = state.packets.slice(0, 120);
  state.packetTimes.push(Date.now());
  state.packetTimes = state.packetTimes.filter(t => Date.now() - t < 60000);
  $("rate").textContent = `${state.packetTimes.length}/min`;
  renderPackets();
}

function renderPackets() {
  $("packet-feed").innerHTML = state.packets.slice(0, 70).map(p => `<div class="feed-row"><header><span>${esc(p.type)}</span><span>${time()}</span></header><code>${esc(p.packet)}</code></div>`).join("") || `<div class="feed-row">Waiting for packets...</div>`;
}

function renderMessages() {
  $("message-feed").innerHTML = state.messages.slice(0, 60).map(m => `<div class="feed-row"><header><span><button class="station-button" data-call="${esc(m.from || "")}">${esc(m.from || "?")}</button> to ${esc(m.to || "?")}</span><span>${age(m.ts)}</span></header><code>${esc(m.text || m.packet || "")}</code></div>`).join("") || `<div class="feed-row">No recent messages.</div>`;
}

function renderStations() {
  const rows = [...state.stations.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $("station-count").textContent = rows.length;
  $("object-count").textContent = `${rows.filter(s => s.type === "object").length} objects`;
  $("station-table").innerHTML = rows.slice(0, 80).map(s => `<tr><td><button class="station-button" data-call="${esc(s.call)}">${esc(s.call)}</button></td><td>${age(s.ts)}</td><td>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</td><td><code>${esc(s.path || "-")}</code></td></tr>`).join("");
}

function drawMap() {
  const c = $("map-canvas");
  if (!c) return;
  if (!c.clientWidth || !c.clientHeight) return;
  const ctx = c.getContext("2d");
  const w = c.width = c.clientWidth * devicePixelRatio;
  const h = c.height = c.clientHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(40,214,159,.14)";
  for (let x = 40; x < c.clientWidth; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.clientHeight); ctx.stroke(); }
  for (let y = 40; y < c.clientHeight; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.clientWidth, y); ctx.stroke(); }
  const stations = [...state.stations.values()];
  if (!stations.length) return;
  const minLat = Math.min(...stations.map(s => s.lat)), maxLat = Math.max(...stations.map(s => s.lat));
  const minLon = Math.min(...stations.map(s => s.lon)), maxLon = Math.max(...stations.map(s => s.lon));
  const pad = 34;
  const watch = new Set($("watchlist").value.toUpperCase().split(/[,\s]+/).filter(Boolean));
  stations.forEach(s => {
    const x = pad + ((s.lon - minLon) / Math.max(.001, maxLon - minLon)) * (c.clientWidth - pad * 2);
    const y = c.clientHeight - pad - ((s.lat - minLat) / Math.max(.001, maxLat - minLat)) * (c.clientHeight - pad * 2);
    ctx.fillStyle = watch.has(s.call.toUpperCase()) ? "#f5bd4f" : (s.type === "object" ? "#5fb3ff" : "#28d69f");
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#dff8ef"; ctx.font = "12px Segoe UI"; ctx.fillText(s.call, x + 8, y + 4);
  });
}

function tx(packetBuilder) {
  if (!state.authed || state.ws?.readyState !== WebSocket.OPEN) { alert("Authenticate first: set callsign/passcode in Settings."); return; }
  let packet;
  try { packet = packetBuilder(); } catch (e) { alert(e.message); return; }
  if (!confirm(`Transmit to APRSNET/APRS-IS?\n\n${packet}`)) return;
  state.ws.send(JSON.stringify({ type: "tx", packet }));
  addPacket(packet, "tx");
}

async function saveSettings() {
  const patch = {
    callsign: cleanCall($("set-callsign").value),
    passcode: $("set-passcode").value.trim(),
    memberUser: $("set-member-user").value.trim(),
    memberPass: $("set-member-pass").value,
    manualLat: $("set-lat").value.trim() !== "" ? Number($("set-lat").value) : null,
    manualLon: $("set-lon").value.trim() !== "" ? Number($("set-lon").value) : null,
    notifications: $("set-notifications").checked,
    minimizeToTray: $("set-tray").checked,
  };
  state.settings = await window.aprsClient.saveSettings(patch);
  authWS();
}

function switchView(name) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  const titles = { dashboard: ["Dashboard", "Live APRSNET status, stations, packets and alerts."], map: ["Tactical Map", "Native canvas station plot with watchlist highlighting."], messages: ["Messages", "Read and send APRS messages through APRSNET."], beacon: ["Beacon / Objects", "Transmit position beacons, objects and raw packets."], weather: ["Weather", "APRSNET weather warning surfaces."], analytics: ["Analytics", "Propagation and network analytics from APRSNET."], settings: ["Settings", "Credentials, member account and desktop integration."] };
  $("view-title").textContent = titles[name][0];
  $("view-subtitle").textContent = titles[name][1];
  if (name === "map") setTimeout(drawMap, 50);
}

async function init() {
  state.settings = await window.aprsClient.getSettings();
  const server = await window.aprsClient.getServer();
  SERVER = server.url || SERVER;
  WS = server.ws || WS;
  $("set-callsign").value = state.settings.callsign || "";
  $("set-passcode").value = state.settings.passcode || "";
  $("set-member-user").value = state.settings.memberUser || "";
  $("set-member-pass").value = state.settings.memberPass || "";
  $("set-lat").value = state.settings.manualLat ?? "";
  $("set-lon").value = state.settings.manualLon ?? "";
  $("set-notifications").checked = state.settings.notifications !== false;
  $("set-tray").checked = state.settings.minimizeToTray !== false;
  if (state.settings.manualLat) $("beacon-lat").value = state.settings.manualLat;
  if (state.settings.manualLon) $("beacon-lon").value = state.settings.manualLon;

  document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-call]");
    if (btn) {
      $("msg-to").value = btn.dataset.call;
      switchView("messages");
      updatePreviews();
    }
  });
  document.querySelectorAll("input, textarea").forEach(i => i.addEventListener("input", () => { updatePreviews(); drawMap(); }));
  $("disconnect").addEventListener("click", () => window.aprsClient.goBack());
  $("refresh").addEventListener("click", () => Promise.all([loadStatus(), loadStations(), loadMessages()]));
  $("clear-feed").addEventListener("click", () => { state.packets = []; renderPackets(); });
  $("send-message").addEventListener("click", () => tx(msgPacket));
  $("send-beacon").addEventListener("click", () => tx(beaconPacket));
  $("send-object").addEventListener("click", () => tx(objectPacket));
  $("send-raw").addEventListener("click", () => tx(rawPacket));
  $("use-position").addEventListener("click", async () => {
    const pos = await window.aprsClient.getPosition();
    if (pos) { $("beacon-lat").value = pos.lat; $("beacon-lon").value = pos.lon; updatePreviews(); }
  });
  $("save-settings").addEventListener("click", saveSettings);
  $("refresh-weather").addEventListener("click", loadWeather);
  $("refresh-analytics").addEventListener("click", loadAnalytics);
  $("fit-map").addEventListener("click", drawMap);

  updatePreviews();
  await memberLogin();
  await Promise.all([loadStatus(), loadStations(), loadMessages(), loadWeather(), loadAnalytics()]);
  connectWS();
  setInterval(loadStatus, 15000);
  setInterval(loadMessages, 30000);
  setInterval(loadStations, 60000);
}

window.addEventListener("load", init);
