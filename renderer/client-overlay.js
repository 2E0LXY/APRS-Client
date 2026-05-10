// Injected into the server page after load
// Adds a client toolbar and wires up desktop notifications

(function() {
  'use strict';
  if (!window.aprsClient) return;

  // ── Client toolbar ──────────────────────────────────────────────────────────
  var toolbar = document.createElement('div');
  toolbar.id  = 'aprs-client-toolbar';
  toolbar.style.cssText = [
    'position:fixed','bottom:0','left:0','right:0','z-index:99999',
    'background:#0f172a','border-top:1px solid #1e3a5f',
    'display:flex','align-items:center','padding:4px 12px',
    'gap:8px','font-family:monospace','font-size:11px','color:#64748b',
    'height:28px'
  ].join(';');

  toolbar.innerHTML = [
    '<span style="color:#38bdf8;font-weight:bold">📡 APRS Client</span>',
    '<span id="ct-call" style="color:#60a5fa;font-weight:bold"></span>',
    '<span style="flex:1"></span>',
    '<span id="ct-server" style="color:#475569"></span>',
    '<span style="color:#334155">|</span>',
    '<button onclick="aprsClientSettings()" style="background:#1e3a5f;border:1px solid #2563eb;color:#60a5fa;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:11px">⚙ Settings</button>',
    '<button onclick="aprsClientDisconnect()" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:11px">⏏ Disconnect</button>',
    '<span id="ct-version" style="color:#334155"></span>'
  ].join('');

  document.body.appendChild(toolbar);

  // Add bottom padding so toolbar doesn't overlap content
  document.body.style.paddingBottom = '28px';

  // ── Populate toolbar ────────────────────────────────────────────────────────
  window.aprsClient.getSettings().then(function(s) {
    var callEl   = document.getElementById('ct-call');
    var serverEl = document.getElementById('ct-server');
    if (callEl   && s.callsign)  callEl.textContent   = s.callsign;
    if (serverEl && s.serverUrl) serverEl.textContent = s.serverUrl.replace(/^https?:\/\//, '');
  });

  window.aprsClient.getVersion().then(function(v) {
    var el = document.getElementById('ct-version');
    if (el) el.textContent = 'v' + v;
  });

  // ── Native desktop notifications ────────────────────────────────────────────
  // Override browser Notification API with native Electron notifications
  var _origNotif = window.Notification;
  window.Notification = function(title, opts) {
    window.aprsClient.showNotification(title, (opts && opts.body) || '');
    return { onclick: null, onclose: null, close: function(){} };
  };
  window.Notification.permission = 'granted';
  window.Notification.requestPermission = function() {
    return Promise.resolve('granted');
  };

  // ── Settings dialog ─────────────────────────────────────────────────────────
  window.aprsClientSettings = function() {
    var existing = document.getElementById('aprs-client-settings-modal');
    if (existing) { existing.remove(); return; }

    window.aprsClient.getSettings().then(function(s) {
      var modal = document.createElement('div');
      modal.id  = 'aprs-client-settings-modal';
      modal.style.cssText = [
        'position:fixed','bottom:36px','right:12px','z-index:999999',
        'background:#1e293b','border:1px solid #334155','border-radius:12px',
        'padding:20px','width:360px','box-shadow:0 -10px 40px rgba(0,0,0,0.6)',
        'font-family:-apple-system,sans-serif','color:#e2e8f0'
      ].join(';');

      modal.innerHTML = [
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">',
        '  <span style="font-weight:700;color:#38bdf8">⚙ Client Settings</span>',
        '  <button onclick="this.closest(\'#aprs-client-settings-modal\').remove()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px">✕</button>',
        '</div>',

        '<label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Server URL</label>',
        '<input id="cs-url" value="'+(s.serverUrl||'')+'" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;margin-bottom:10px;box-sizing:border-box">',

        '<div style="display:flex;gap:8px;margin-bottom:10px">',
        '  <div style="flex:1"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Callsign</label>',
        '  <input id="cs-call" value="'+(s.callsign||'')+'" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;box-sizing:border-box;text-transform:uppercase"></div>',
        '  <div style="flex:1"><label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Passcode</label>',
        '  <input id="cs-pass" type="password" value="'+(s.passcode||'')+'" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;box-sizing:border-box"></div>',
        '</div>',

        '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;color:#94a3b8;cursor:pointer">',
        '  <input type="checkbox" id="cs-auto" '+(s.autoConnect?'checked':'')+' style="accent-color:#38bdf8"> Auto-connect on startup',
        '</label>',
        '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;color:#94a3b8;cursor:pointer">',
        '  <input type="checkbox" id="cs-tray" '+(s.minimizeToTray!==false?'checked':'')+' style="accent-color:#38bdf8"> Minimise to tray on close',
        '</label>',
        '<label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:13px;color:#94a3b8;cursor:pointer">',
        '  <input type="checkbox" id="cs-notif" '+(s.notifications!==false?'checked':'')+' style="accent-color:#38bdf8"> Desktop notifications',
        '</label>',

        '<div style="display:flex;gap:8px">',
        '  <button onclick="aprsClientSaveSettings()" style="flex:1;background:#2563eb;border:none;color:#fff;padding:10px;border-radius:8px;cursor:pointer;font-weight:700">Save & Reconnect</button>',
        '  <button onclick="this.closest(\'#aprs-client-settings-modal\').remove()" style="background:#334155;border:none;color:#94a3b8;padding:10px 16px;border-radius:8px;cursor:pointer">Cancel</button>',
        '</div>'
      ].join('');

      document.body.appendChild(modal);
    });
  };

  window.aprsClientSaveSettings = function() {
    var url  = (document.getElementById('cs-url')  ||{}).value || '';
    var call = (document.getElementById('cs-call') ||{}).value || '';
    var pass = (document.getElementById('cs-pass') ||{}).value || '';
    if (!url) return;
    if (!url.startsWith('http')) url = 'https://' + url;
    window.aprsClient.saveSettings({
      serverUrl:      url,
      wsUrl:          url.replace(/^http/, 'ws') + '/ws',
      callsign:       call.toUpperCase(),
      passcode:       pass,
      autoConnect:    (document.getElementById('cs-auto') ||{}).checked,
      minimizeToTray: (document.getElementById('cs-tray') ||{}).checked,
      notifications:  (document.getElementById('cs-notif')||{}).checked
    }).then(function() {
      window.aprsClient.connectToServer(url);
    });
  };

  window.aprsClientDisconnect = function() {
    window.aprsClient.goBack();
  };

  // ── Pass callsign/passcode into the server UI ───────────────────────────────
  window.aprsClient.getSettings().then(function(s) {
    if (!s.callsign) return;

    var tryInject = function(attempts) {
      // Try to auto-fill the message auth modal
      var callEl = document.getElementById('msg-auth-call') ||
                   document.getElementById('aprsCall') ||
                   document.querySelector('[placeholder*="callsign" i]');
      var passEl = document.getElementById('msg-auth-pass') ||
                   document.getElementById('aprsPass') ||
                   document.querySelector('[placeholder*="passcode" i]');

      if (callEl && !callEl.value) callEl.value = s.callsign;
      if (passEl && !passEl.value) passEl.value = s.passcode || '';

      // Store globally so server JS can read them
      window._clientCallsign = s.callsign;
      window._clientPasscode = s.passcode || '';

      // If server exposes a myCallsign variable, set it
      if (typeof window.myCallsign !== 'undefined' && !window.myCallsign) {
        window.myCallsign = s.callsign;
      }

      if (attempts > 0) setTimeout(function(){ tryInject(attempts-1); }, 1000);
    };

    // Try immediately and then retry a few times as page loads
    setTimeout(function(){ tryInject(5); }, 500);
  });

})();
