// ===========================================================================
//  APRS Client - overlay script
//  Injected into the aprsnet.uk website after every page load. Adds a desktop
//  toolbar and bridges website features to native desktop capabilities:
//    - remembers website appearance prefs (theme / map style / filters / toggles)
//    - single sign-on to the website member account
//    - native desktop notifications for APRS messages
//    - plots the operator's own GPS / manual location on the map
//    - quick message-send from the toolbar
// ===========================================================================
(function () {
  'use strict';
  if (!window.aprsClient) return;
  if (window.__aprsOverlayLoaded) return;
  window.__aprsOverlayLoaded = true;

  var SETTINGS = {};
  var POS_MARKER = null;
  var POS_TIMER  = null;

  function $(id) { return document.getElementById(id); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function waitFor(test, tries, gap) {
    return new Promise(function (resolve) {
      var n = 0;
      (function poll() {
        var v = test();
        if (v) return resolve(v);
        if (++n >= tries) return resolve(null);
        setTimeout(poll, gap || 400);
      })();
    });
  }

  // -- toolbar ---------------------------------------------------------------
  function buildToolbar() {
    if ($('aprs-client-toolbar')) return;
    var bar = document.createElement('div');
    bar.id = 'aprs-client-toolbar';
    bar.style.cssText = [
      'position:fixed', 'bottom:0', 'left:0', 'right:0', 'z-index:99999',
      'background:#0f172a', 'border-top:1px solid #1e3a5f',
      'display:flex', 'align-items:center', 'padding:4px 12px', 'gap:8px',
      'font-family:monospace', 'font-size:11px', 'color:#64748b', 'height:30px'
    ].join(';');
    bar.innerHTML = [
      '<span style="color:#38bdf8;font-weight:bold">APRS Client</span>',
      '<span id="ct-call" style="color:#60a5fa;font-weight:bold"></span>',
      '<span id="ct-pos" style="color:#475569" title="Your plotted location"></span>',
      '<span style="flex:1"></span>',
      '<button id="ct-msg-btn" class="ct-btn">Message</button>',
      '<button id="ct-loc-btn" class="ct-btn">My Location</button>',
      '<button id="ct-set-btn" class="ct-btn">Settings</button>',
      '<button id="ct-dc-btn" class="ct-btn ct-btn-dim">Disconnect</button>',
      '<span id="ct-version" style="color:#334155"></span>'
    ].join('');
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '30px';

    var st = document.createElement('style');
    st.textContent =
      '.ct-btn{background:#1e3a5f;border:1px solid #2563eb;color:#60a5fa;' +
      'padding:2px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:monospace}' +
      '.ct-btn:hover{background:#2563eb;color:#fff}' +
      '.ct-btn-dim{background:#1e293b;border-color:#334155;color:#94a3b8}' +
      '.ct-btn-dim:hover{background:#334155;color:#fff}';
    document.head.appendChild(st);

    $('ct-msg-btn').onclick = openQuickMessage;
    $('ct-loc-btn').onclick = plotMyLocationNow;
    $('ct-set-btn').onclick = openClientSettings;
    $('ct-dc-btn').onclick  = function () { window.aprsClient.goBack(); };
  }

  // -- native desktop notifications ------------------------------------------
  // Replace the page Notification API with native Electron notifications so
  // APRS message alerts appear as real Windows toasts even when minimised.
  function hookNotifications() {
    try {
      window.Notification = function (title, opts) {
        if (SETTINGS.notifications !== false)
          window.aprsClient.showNotification(title, (opts && opts.body) || '');
        return { onclick: null, onclose: null, close: function () {} };
      };
      window.Notification.permission = 'granted';
      window.Notification.requestPermission = function () { return Promise.resolve('granted'); };
    } catch (e) {}
  }

  // -- apply remembered website appearance preferences -----------------------
  // The client remembers how the user likes the site set up and re-applies it
  // on every page load: theme, map style, station filters, feature toggles.
  function applyAppearancePrefs() {
    if (!SETTINGS.prefsSynced) return;

    if (SETTINGS.prefTheme === 'dark' || SETTINGS.prefTheme === 'light') {
      try {
        var cur = document.documentElement.getAttribute('data-theme');
        if (cur !== SETTINGS.prefTheme && typeof window.toggleTheme === 'function') {
          window.toggleTheme();
        } else if (cur !== SETTINGS.prefTheme) {
          document.documentElement.setAttribute('data-theme', SETTINGS.prefTheme);
          localStorage.setItem('aprs-theme', SETTINGS.prefTheme);
        }
      } catch (e) {}
    }

    if (SETTINGS.prefMapStyle) {
      var ms = $('map-style');
      if (ms && ms.value !== SETTINGS.prefMapStyle) {
        ms.value = SETTINGS.prefMapStyle;
        ms.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (SETTINGS.prefFilters && typeof SETTINGS.prefFilters === 'object') {
      Object.keys(SETTINGS.prefFilters).forEach(function (id) {
        var cb = $(id);
        if (cb && cb.type === 'checkbox') {
          var want = !!SETTINGS.prefFilters[id];
          if (cb.checked !== want) {
            cb.checked = want;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
    }

    [['prefAutoFit', 'autoFit'], ['prefGhost', 'ghostOld'],
     ['prefPropLines', 'propLines'], ['prefWxRadar', 'wxRadar']].forEach(function (pair) {
      var want = SETTINGS[pair[0]];
      if (want === null || typeof want === 'undefined') return;
      var cb = $(pair[1]);
      if (cb && cb.type === 'checkbox' && cb.checked !== !!want) {
        cb.checked = !!want;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // Read the CURRENT state of the website appearance controls so the user can
  // capture "how I like it" into client settings with one click.
  function captureAppearancePrefs() {
    var prefs = {
      prefTheme:    document.documentElement.getAttribute('data-theme') || 'dark',
      prefMapStyle: ($('map-style') || {}).value || '',
      prefFilters:  {},
      prefAutoFit:   $('autoFit')   ? $('autoFit').checked   : null,
      prefGhost:     $('ghostOld')  ? $('ghostOld').checked  : null,
      prefPropLines: $('propLines') ? $('propLines').checked : null,
      prefWxRadar:   $('wxRadar')   ? $('wxRadar').checked   : null,
      prefsSynced:   true
    };
    ['show-aprs', 'show-cwop', 'show-ogn', 'show-objects', 'show-phg',
     'show-all-connections', 'show-pistar', 'show-lora-aprsis',
     'show-seamarks', 'show-ships', 'show-lora'].forEach(function (id) {
      var cb = $(id);
      if (cb && cb.type === 'checkbox') prefs.prefFilters[id] = cb.checked;
    });
    return prefs;
  }

  // -- single sign-on to the website member account --------------------------
  // If the user stored member-account credentials, sign them in automatically.
  function autoMemberLogin() {
    if (!SETTINGS.autoMemberLogin) return;
    if (!SETTINGS.memberUser || !SETTINGS.memberPass) return;

    // already logged in? the member button label changes from "Login"
    var btnLabel = $('member-btn-label');
    if (btnLabel && btnLabel.textContent &&
        btnLabel.textContent.toLowerCase().indexOf('login') === -1 &&
        btnLabel.textContent.trim() !== '') return;

    // open the member modal, fill the login form, submit
    waitFor(function () { return $('member-btn'); }, 12, 500).then(function (btn) {
      if (!btn) return;
      btn.click();
      return waitFor(function () { return $('mm-login-call'); }, 12, 300);
    }).then(function (callEl) {
      if (!callEl) return;
      var passEl = $('mm-login-pass');
      callEl.value = SETTINGS.memberUser;
      callEl.dispatchEvent(new Event('input', { bubbles: true }));
      if (passEl) {
        passEl.value = SETTINGS.memberPass;
        passEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof window.memberLogin === 'function') {
        window.memberLogin();
      } else {
        // fall back to clicking the form's submit button
        var form = $('mm-login');
        var sub = form && form.querySelector('button[type=submit], button');
        if (sub) sub.click();
      }
      // close the modal shortly after a successful login
      setTimeout(function () {
        var modal = $('member-modal');
        var lbl = $('member-btn-label');
        if (modal && lbl && lbl.textContent.toLowerCase().indexOf('login') === -1) {
          modal.classList.add('hidden');
        }
      }, 2500);
    });
  }

  // -- fill APRS messaging credentials ---------------------------------------
  function fillAPRSCredentials() {
    if (!SETTINGS.callsign) return;
    var tries = 6;
    (function attempt() {
      var callEl = $('myCall');
      var passEl = $('myPass');
      if (callEl && !callEl.value) {
        callEl.value = SETTINGS.callsign;
        callEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (passEl && !passEl.value && SETTINGS.passcode) {
        passEl.value = SETTINGS.passcode;
        passEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      window._clientCallsign = SETTINGS.callsign;
      window._clientPasscode = SETTINGS.passcode || '';
      if (typeof window.myCallsign !== 'undefined' && !window.myCallsign)
        window.myCallsign = SETTINGS.callsign;
      if (--tries > 0) setTimeout(attempt, 1000);
    })();
  }

  // -- position: GPS or manual, plotted on the map ---------------------------
  // Acquire a GPS fix via the browser geolocation API (Electron grants the
  // permission), report it to the main process, and drop a marker on the map.
  function acquireGPS() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (p) {
          var fix = { lat: p.coords.latitude, lon: p.coords.longitude,
                      accuracy: p.coords.accuracy };
          window.aprsClient.reportPosition(fix);
          resolve(fix);
        },
        function () { resolve(null); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  // Resolve the operator position from whichever source is configured.
  function resolvePosition() {
    if (SETTINGS.positionMode === 'off') return Promise.resolve(null);
    if (SETTINGS.positionMode === 'manual') {
      if (typeof SETTINGS.manualLat === 'number' && typeof SETTINGS.manualLon === 'number')
        return Promise.resolve({ lat: SETTINGS.manualLat, lon: SETTINGS.manualLon, source: 'manual' });
      return Promise.resolve(null);
    }
    // GPS mode: try a live fix, fall back to last known from main process
    return acquireGPS().then(function (fix) {
      if (fix) return Object.assign({ source: 'gps' }, fix);
      return window.aprsClient.getPosition();
    });
  }

  // Drop / move a marker for the operator's own location on the Leaflet map.
  function plotPosition(pos) {
    if (!pos || typeof window.L === 'undefined' || typeof window.map === 'undefined') return;
    var ll = [pos.lat, pos.lon];
    try {
      if (POS_MARKER) {
        POS_MARKER.setLatLng(ll);
      } else {
        var icon = window.L.divIcon({
          className: 'aprs-client-mypos',
          html: '<div style="width:18px;height:18px;border-radius:50%;' +
                'background:#22d3ee;border:3px solid #0e7490;' +
                'box-shadow:0 0 10px #22d3ee,0 0 4px #fff"></div>',
          iconSize: [18, 18], iconAnchor: [9, 9]
        });
        POS_MARKER = window.L.marker(ll, { icon: icon, zIndexOffset: 10000 })
          .addTo(window.map)
          .bindPopup('<b>' + (SETTINGS.callsign || 'My Station') + '</b><br>' +
                     'Your location (' + (pos.source || '') + ')<br>' +
                     pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5));
      }
      var pe = $('ct-pos');
      if (pe) pe.textContent = 'POS ' + pos.lat.toFixed(3) + ',' + pos.lon.toFixed(3) +
                               ' (' + (pos.source || '?') + ')';
    } catch (e) {}
  }

  function plotMyLocationNow() {
    var pe = $('ct-pos');
    if (pe) pe.textContent = 'locating...';
    resolvePosition().then(function (pos) {
      if (!pos) {
        if (pe) pe.textContent = 'no position';
        alert('No position available.\n\nSet GPS or a manual location in\nSettings > My Location.');
        return;
      }
      plotPosition(pos);
      if (window.map && POS_MARKER) {
        window.map.setView([pos.lat, pos.lon], Math.max(window.map.getZoom(), 11));
        POS_MARKER.openPopup();
      }
    });
  }

  // Periodically refresh the position marker (keeps it current while moving).
  function startPositionLoop() {
    if (POS_TIMER) clearInterval(POS_TIMER);
    if (SETTINGS.positionMode === 'off' || !SETTINGS.beaconToMap) return;
    var mins = Math.max(1, SETTINGS.beaconIntervalMin || 10);
    // initial fix once the map is ready
    waitFor(function () { return typeof window.map !== 'undefined'; }, 30, 1000)
      .then(function () {
        resolvePosition().then(plotPosition);
      });
    POS_TIMER = setInterval(function () {
      resolvePosition().then(plotPosition);
    }, mins * 60000);
  }

  // -- quick message send ----------------------------------------------------
  // A small composer in the toolbar that drives the website's messaging panel.
  function openQuickMessage() {
    var existing = $('aprs-client-msg-modal');
    if (existing) { existing.remove(); return; }

    var m = document.createElement('div');
    m.id = 'aprs-client-msg-modal';
    m.style.cssText = [
      'position:fixed', 'bottom:38px', 'right:12px', 'z-index:999999',
      'background:#1e293b', 'border:1px solid #334155', 'border-radius:12px',
      'padding:18px', 'width:340px', 'box-shadow:0 -10px 40px rgba(0,0,0,0.6)',
      'font-family:-apple-system,sans-serif', 'color:#e2e8f0'
    ].join(';');
    m.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">',
      '  <span style="font-weight:700;color:#38bdf8">Send APRS Message</span>',
      '  <button id="qm-x" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px">x</button>',
      '</div>',
      '<label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">To callsign</label>',
      '<input id="qm-to" placeholder="M0ABC" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;margin-bottom:10px;box-sizing:border-box;text-transform:uppercase">',
      '<label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">Message</label>',
      '<textarea id="qm-text" rows="3" maxlength="67" placeholder="Up to 67 characters" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;margin-bottom:4px;box-sizing:border-box;resize:none"></textarea>',
      '<div id="qm-count" style="font-size:10px;color:#475569;text-align:right;margin-bottom:10px">0 / 67</div>',
      '<button id="qm-send" style="width:100%;background:#2563eb;border:none;color:#fff;padding:10px;border-radius:8px;cursor:pointer;font-weight:700">Send</button>',
      '<div id="qm-status" style="font-size:11px;text-align:center;margin-top:8px;min-height:14px;color:#64748b"></div>'
    ].join('');
    document.body.appendChild(m);

    $('qm-x').onclick = function () { m.remove(); };
    $('qm-text').addEventListener('input', function () {
      $('qm-count').textContent = this.value.length + ' / 67';
    });
    $('qm-send').onclick = function () { sendQuickMessage(m); };
    setTimeout(function () { $('qm-to').focus(); }, 50);
  }

  // Drive the website's own messaging controls to actually transmit.
  function sendQuickMessage(modal) {
    var to   = ($('qm-to')   || {}).value || '';
    var text = ($('qm-text') || {}).value || '';
    var status = $('qm-status');
    to = to.trim().toUpperCase();
    text = text.trim();
    if (!to || !text) {
      if (status) { status.textContent = 'Enter a callsign and message'; status.style.color = '#f87171'; }
      return;
    }

    // Make sure the website messaging panel is set up + authenticated
    if (typeof window.togglePanel === 'function') {
      try { window.togglePanel('messages'); } catch (e) {}
    }
    fillAPRSCredentials();

    setTimeout(function () {
      var destEl = $('destCall');
      var textEl = $('msgText');
      if (!destEl || !textEl) {
        if (status) { status.textContent = 'Messaging panel not ready - open it once first';
                      status.style.color = '#f87171'; }
        return;
      }
      destEl.value = to;
      destEl.dispatchEvent(new Event('input', { bubbles: true }));
      textEl.value = text;
      textEl.dispatchEvent(new Event('input', { bubbles: true }));

      // find and click the website's send button
      var sent = false;
      if (typeof window.sendMessage === 'function') {
        try { window.sendMessage(); sent = true; } catch (e) {}
      }
      if (!sent) {
        var btn = document.querySelector('#messages-panel button[onclick*="send" i], ' +
                                         '#compose-section button');
        if (btn) { btn.click(); sent = true; }
      }
      if (status) {
        if (sent) {
          status.textContent = 'Message sent to ' + to;
          status.style.color = '#4ade80';
          setTimeout(function () { modal.remove(); }, 1400);
        } else {
          status.textContent = 'Could not find the send control';
          status.style.color = '#f87171';
        }
      }
    }, 600);
  }

  // -- client settings dialog ------------------------------------------------
  function openClientSettings() {
    var existing = $('aprs-client-settings-modal');
    if (existing) { existing.remove(); return; }

    var s = SETTINGS;
    var m = document.createElement('div');
    m.id = 'aprs-client-settings-modal';
    m.style.cssText = [
      'position:fixed', 'bottom:38px', 'right:12px', 'z-index:999999',
      'background:#1e293b', 'border:1px solid #334155', 'border-radius:12px',
      'padding:18px', 'width:380px', 'max-height:78vh', 'overflow-y:auto',
      'box-shadow:0 -10px 40px rgba(0,0,0,0.6)',
      'font-family:-apple-system,sans-serif', 'color:#e2e8f0'
    ].join(';');

    function chk(id, on, label) {
      return '<label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;' +
             'font-size:13px;color:#94a3b8;cursor:pointer">' +
             '<input type="checkbox" id="' + id + '" ' + (on ? 'checked' : '') +
             ' style="accent-color:#38bdf8"> ' + label + '</label>';
    }
    function inp(id, val, ph, type) {
      return '<input id="' + id + '" type="' + (type || 'text') + '" value="' +
             (val == null ? '' : String(val).replace(/"/g, '&quot;')) + '" placeholder="' +
             (ph || '') + '" style="width:100%;background:#0f172a;border:1px solid #334155;' +
             'border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;margin-bottom:10px;' +
             'box-sizing:border-box">';
    }
    function lbl(t) {
      return '<label style="font-size:11px;color:#64748b;display:block;margin-bottom:4px">' +
             t + '</label>';
    }
    function head(t) {
      return '<div style="font-size:11px;font-weight:700;text-transform:uppercase;' +
             'letter-spacing:1px;color:#475569;margin:14px 0 8px">' + t + '</div>';
    }

    m.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      '  <span style="font-weight:700;color:#38bdf8">Client Settings</span>',
      '  <button id="cs-x" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px">x</button>',
      '</div>',
      '<div style="font-size:11px;color:#475569;margin-bottom:4px">Server: www.aprsnet.uk (fixed)</div>',

      head('APRS messaging'),
      '<div style="display:flex;gap:8px">',
      '  <div style="flex:1">' + lbl('Callsign') +
        '<input id="cs-call" value="' + (s.callsign || '') +
        '" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;' +
        'padding:8px;color:#e2e8f0;font-size:13px;margin-bottom:10px;box-sizing:border-box;' +
        'text-transform:uppercase"></div>',
      '  <div style="flex:1">' + lbl('Passcode') +
        inp('cs-pass', s.passcode, '12345', 'password') + '</div>',
      '</div>',

      head('Website member account (single sign-on)'),
      lbl('Member username / callsign'), inp('cs-muser', s.memberUser, 'your account'),
      lbl('Member password'), inp('cs-mpass', s.memberPass, '', 'password'),
      chk('cs-mauto', s.autoMemberLogin !== false, 'Sign in to my member account automatically'),

      head('My location on the map'),
      lbl('Position source'),
      '<select id="cs-posmode" style="width:100%;background:#0f172a;border:1px solid #334155;' +
        'border-radius:6px;padding:8px;color:#e2e8f0;font-size:13px;margin-bottom:10px;box-sizing:border-box">' +
        '<option value="gps"' + (s.positionMode === 'gps' ? ' selected' : '') + '>GPS (automatic)</option>' +
        '<option value="manual"' + (s.positionMode === 'manual' ? ' selected' : '') + '>Manual coordinates</option>' +
        '<option value="off"' + (s.positionMode === 'off' ? ' selected' : '') + '>Off</option>' +
      '</select>',
      '<div style="display:flex;gap:8px">',
      '  <div style="flex:1">' + lbl('Latitude') + inp('cs-lat', s.manualLat, '53.7') + '</div>',
      '  <div style="flex:1">' + lbl('Longitude') + inp('cs-lon', s.manualLon, '-1.6') + '</div>',
      '</div>',
      chk('cs-beacon', s.beaconToMap !== false, 'Show my location marker on the map'),

      head('Startup and behaviour'),
      chk('cs-auto', s.autoConnect !== false, 'Open the website automatically on startup'),
      chk('cs-tray', s.minimizeToTray !== false, 'Minimise to system tray on close'),
      chk('cs-notif', s.notifications !== false, 'Native desktop notifications'),
      chk('cs-startmin', !!s.startMinimized, 'Start minimised to tray'),
      chk('cs-startup', !!s.launchOnStartup, 'Launch APRS Client when Windows starts'),

      head('Website appearance'),
      '<div style="font-size:11px;color:#64748b;margin-bottom:8px">' +
        'Set the site up how you like it (dark/light, map style, filters), then ' +
        'capture it here. The client re-applies it every time.</div>',
      '<button id="cs-capture" style="width:100%;background:#0e7490;border:none;color:#fff;' +
        'padding:9px;border-radius:8px;cursor:pointer;font-weight:600;margin-bottom:6px">' +
        'Capture current website layout</button>',
      '<div id="cs-prefstate" style="font-size:11px;text-align:center;margin-bottom:10px;color:#64748b">' +
        (s.prefsSynced ? 'Saved: ' + (s.prefTheme || 'dark') + ' theme'
                         + (s.prefMapStyle ? ', ' + s.prefMapStyle + ' map' : '')
                       : 'No layout captured yet') + '</div>',

      '<div style="display:flex;gap:8px;margin-top:6px">',
      '  <button id="cs-save" style="flex:1;background:#2563eb;border:none;color:#fff;padding:10px;' +
        'border-radius:8px;cursor:pointer;font-weight:700">Save</button>',
      '  <button id="cs-cancel" style="background:#334155;border:none;color:#94a3b8;padding:10px 16px;' +
        'border-radius:8px;cursor:pointer">Cancel</button>',
      '</div>',
      '<div id="cs-status" style="font-size:11px;text-align:center;margin-top:8px;min-height:14px;color:#64748b"></div>'
    ].join('');
    document.body.appendChild(m);

    var capturedPrefs = null;

    $('cs-x').onclick = $('cs-cancel').onclick = function () { m.remove(); };

    $('cs-capture').onclick = function () {
      capturedPrefs = captureAppearancePrefs();
      var ps = $('cs-prefstate');
      if (ps) {
        ps.textContent = 'Captured: ' + capturedPrefs.prefTheme + ' theme'
          + (capturedPrefs.prefMapStyle ? ', ' + capturedPrefs.prefMapStyle + ' map' : '')
          + ' (Save to keep)';
        ps.style.color = '#4ade80';
      }
    };

    $('cs-save').onclick = function () {
      var patch = {
        callsign:        ($('cs-call')  || {}).value.trim().toUpperCase(),
        passcode:        ($('cs-pass')  || {}).value.trim(),
        memberUser:      ($('cs-muser') || {}).value.trim(),
        memberPass:      ($('cs-mpass') || {}).value,
        autoMemberLogin: ($('cs-mauto') || {}).checked,
        positionMode:    ($('cs-posmode') || {}).value || 'gps',
        manualLat:       parseFloat(($('cs-lat') || {}).value) ,
        manualLon:       parseFloat(($('cs-lon') || {}).value),
        beaconToMap:     ($('cs-beacon') || {}).checked,
        autoConnect:     ($('cs-auto')   || {}).checked,
        minimizeToTray:  ($('cs-tray')   || {}).checked,
        notifications:   ($('cs-notif')  || {}).checked,
        startMinimized:  ($('cs-startmin') || {}).checked,
        launchOnStartup: ($('cs-startup')  || {}).checked
      };
      if (isNaN(patch.manualLat)) patch.manualLat = null;
      if (isNaN(patch.manualLon)) patch.manualLon = null;
      if (capturedPrefs) Object.assign(patch, capturedPrefs);

      window.aprsClient.saveSettings(patch).then(function (fresh) {
        SETTINGS = fresh;
        var st = $('cs-status');
        if (st) { st.textContent = 'Settings saved'; st.style.color = '#4ade80'; }
        // re-apply immediately
        updateToolbar();
        fillAPRSCredentials();
        startPositionLoop();
        setTimeout(function () { m.remove(); }, 1000);
      });
    };
  }

  // -- toolbar refresh -------------------------------------------------------
  function updateToolbar() {
    var ce = $('ct-call');
    if (ce) ce.textContent = SETTINGS.callsign || '';
    window.aprsClient.getVersion().then(function (v) {
      var ve = $('ct-version');
      if (ve) ve.textContent = 'v' + v;
    });
  }

  // -- boot ------------------------------------------------------------------
  window.aprsClient.getSettings().then(function (s) {
    SETTINGS = s || {};
    buildToolbar();
    hookNotifications();
    updateToolbar();

    // Re-apply preferences and credentials once the page scripts have run
    setTimeout(function () {
      applyAppearancePrefs();
      fillAPRSCredentials();
      autoMemberLogin();
      startPositionLoop();
    }, 1200);
  });

  // keep settings fresh if the main process pushes an update
  window.aprsClient.onSettings(function (s) {
    SETTINGS = s || SETTINGS;
    updateToolbar();
  });

})();
