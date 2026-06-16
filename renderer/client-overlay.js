/**
 * APRS Client - desktop overlay v1.3.0
 * Injected by main.js into every aprsnet.uk page after load.
 *
 * Adds: desktop toolbar, auto member login, OS notifications,
 *       GPS forwarding, two-way filter persistence, theme apply.
 */
(async function () {
    'use strict';
    if (window.__aprsClientOverlay) return;
    window.__aprsClientOverlay = true;

    const ac = window.aprsClient;
    if (!ac) return;

    const s = await ac.getSettings();
    ac.onSettings(ns => Object.assign(s, ns));

    /* ── 1. TOOLBAR ─────────────────────────────────────────────────────── */
    const TB_H = 36;
    function buildToolbar() {
        document.documentElement.style.paddingTop = TB_H + 'px';

        const tb = document.createElement('div');
        tb.id = '__aprs_tb';
        Object.assign(tb.style, {
            position:   'fixed', top: '0', left: '0', right: '0',
            height:     TB_H + 'px', zIndex: '2147483647',
            background: '#0c1527', borderBottom: '1px solid #1e3a5f',
            display:    'flex', alignItems: 'center',
            padding:    '0 12px', gap: '10px',
            fontFamily: 'Segoe UI,sans-serif', fontSize: '12px',
            userSelect: 'none', WebkitAppRegion: 'drag'
        });

        const logo = el('span', '\uD83D\uDCE1 APRS Client', {
            color: '#38bdf8', fontWeight: '700', fontSize: '13px',
            letterSpacing: '-0.3px', marginRight: '4px'
        });

        const callBadge = el('span', s.callsign || '(no callsign)', {
            background: '#1e3a5f', border: '1px solid #2563eb', color: '#60a5fa',
            padding: '2px 10px', borderRadius: '20px', fontWeight: '700',
            fontSize: '11px', letterSpacing: '0.4px'
        });
        tb.callBadge = callBadge;

        /* WS dot — reads #conn-status from the site's own DOM */
        const wsDot = el('span', '\u25CF', {
            color: '#475569', fontSize: '14px', lineHeight: '1',
            title: 'WebSocket state'
        });
        tb.wsDot = wsDot;

        const gpsDot = el('span', '\uD83D\uDCCD', {
            color: '#475569', fontSize: '12px', cursor: 'default',
            WebkitAppRegion: 'no-drag'
        });
        tb.gpsDot = gpsDot;

        const unread = el('span', '', {
            background: '#ef4444', color: '#fff', borderRadius: '10px',
            padding: '1px 7px', fontSize: '10px', fontWeight: '700',
            display: 'none', WebkitAppRegion: 'no-drag'
        });
        unread.id = '__aprs_unread_badge';
        tb.unreadBadge = unread;

        const spacer = el('div', '', { flex: '1' });
        const settingsBtn = btn('\u2699', 'Desktop settings', () => openDesktopSettings());
        const discBtn = btn('\u2715 Disconnect', 'Return to connect screen',
            () => ac.goBack(), '#dc2626');

        const bleBtn = btn('⚫ BLE', 'Connect BLE radio (RT-950 Pro)', () => toggleBLE());
        bleBtn.id = '__aprs_ble_btn';
        tb.append(logo, callBadge, wsDot, gpsDot, unread, spacer, bleBtn, settingsBtn, discBtn);
        document.body.appendChild(tb);

        /* Poll #conn-status for WS state — no site globals needed */
        setInterval(() => {
            const call = s.callsign || window.myCallsign || '';
            if (call) callBadge.textContent = call;

            const dot = document.getElementById('conn-status');
            if (dot) {
                const cls = dot.className;
                if (cls.includes('bg-green-500')) {
                    wsDot.style.color = '#4ade80';
                    wsDot.title = 'WebSocket: ' + (dot.title || 'Connected');
                } else if (cls.includes('bg-yellow-500')) {
                    wsDot.style.color = '#facc15';
                    wsDot.title = 'WebSocket: ' + (dot.title || 'Connecting\u2026');
                } else {
                    wsDot.style.color = '#ef4444';
                    wsDot.title = 'WebSocket: ' + (dot.title || 'Disconnected');
                }
            }
        }, 1000);
    }

    function el(tag, text, styles) {
        const e = document.createElement(tag);
        e.textContent = text;
        if (styles) Object.assign(e.style, styles);
        return e;
    }

    function btn(text, title, onClick, bg) {
        const b = document.createElement('button');
        b.textContent = text; b.title = title;
        Object.assign(b.style, {
            background: bg || 'transparent',
            border: bg ? 'none' : '1px solid #334155',
            borderRadius: '6px', color: '#e2e8f0',
            padding: '3px 10px', fontSize: '11px',
            cursor: 'pointer', fontFamily: 'inherit',
            WebkitAppRegion: 'no-drag', transition: 'background 0.15s'
        });
        b.addEventListener('click', onClick);
        b.addEventListener('mouseenter', () =>
            b.style.background = bg ? bg + 'cc' : '#1e293b');
        b.addEventListener('mouseleave', () =>
            b.style.background = bg || 'transparent');
        return b;
    }

    /* ── 2. MEMBER AUTO-LOGIN ────────────────────────────────────────────── */
    async function tryMemberLogin() {
        if (!s.memberUser || !s.memberPass || !s.autoMemberLogin) return;
        try {
            const r = await fetch('/api/member/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callsign: s.memberUser, password: s.memberPass })
            });
            const d = await r.json();
            if (!d.token) return;
            window.__memberToken = d.token;
            if (typeof window.onMemberLoginSuccess === 'function') {
                window.onMemberLoginSuccess(d);
            }
            if (d.callsign) {
                const tb = document.getElementById('__aprs_tb');
                if (tb && tb.callBadge) tb.callBadge.textContent = d.callsign;
            }
        } catch (_) {}
    }

    /* ── 3. DESKTOP NOTIFICATION HOOK ───────────────────────────────────── */
    let _lastNotifiedTs = 0;

    function hookNotifications() {
        function tryHook(attempts) {
            if (typeof window.logChat === 'function') {
                const orig = window.logChat;
                window.logChat = function (from, text, cls) {
                    // logChat is called with from="FROMCALL→TOCALL" for personal messages.
                    // Only notify when the message is addressed to our callsign.
                    // Sentinel values (ACK, SYS, CLIENT, SERVER, 🚨) are never personal messages.
                    const myCall = (s.callsign || window.myCallsign || '').toUpperCase();
                    const SENTINEL = /^(ACK|SYS|CLIENT|SERVER)$/i;
                    if (myCall && from && typeof text === 'string' && !SENTINEL.test(from)) {
                        const arrow = String(from).match(/^([A-Z0-9\-]+)\s*[\u2192>]\s*([A-Z0-9\-]+)$/i);
                        if (arrow) {
                            const fromCall = arrow[1].toUpperCase();
                            const toCall   = arrow[2].toUpperCase();
                            if (toCall === myCall && fromCall !== myCall) {
                                const now = Date.now();
                                if (now - _lastNotifiedTs > 2000) {
                                    _lastNotifiedTs = now;
                                    ac.showNotification(
                                        fromCall + ' \u2192 ' + myCall,
                                        text.replace(/[\r\n]+/g, ' ').substring(0, 120)
                                    );
                                    const tb = document.getElementById('__aprs_tb');
                                    if (tb && tb.unreadBadge) {
                                        const cur = parseInt(tb.unreadBadge.textContent) || 0;
                                        tb.unreadBadge.textContent = String(cur + 1);
                                        tb.unreadBadge.style.display = 'inline-block';
                                    }
                                }
                            }
                        }
                    }
                    return orig.apply(this, arguments);
                };
                return;
            }
            if (attempts > 0) setTimeout(() => tryHook(attempts - 1), 600);
        }
        tryHook(20);
    }

    /* ── 4. GPS REPORTING ────────────────────────────────────────────────── */
    function startGPS() {
        if (s.positionMode === 'off') return;
        if (s.positionMode === 'manual') {
            if (typeof s.manualLat === 'number') {
                ac.reportPosition({ lat: s.manualLat, lon: s.manualLon });
                injectMyLocation(s.manualLat, s.manualLon);
            }
            return;
        }
        if (!navigator.geolocation) return;
        const tb = document.getElementById('__aprs_tb');
        navigator.geolocation.watchPosition(
            pos => {
                const fix = {
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracy: pos.coords.accuracy
                };
                ac.reportPosition(fix);
                injectMyLocation(fix.lat, fix.lon);
                if (tb && tb.gpsDot) {
                    tb.gpsDot.style.color = '#4ade80';
                    tb.gpsDot.title = 'GPS: ' +
                        fix.lat.toFixed(4) + ', ' + fix.lon.toFixed(4);
                }
            },
            () => {
                if (tb && tb.gpsDot) {
                    tb.gpsDot.style.color = '#ef4444';
                    tb.gpsDot.title = 'GPS: no fix';
                }
            },
            { enableHighAccuracy: true, maximumAge: 10000 }
        );
    }

    function injectMyLocation(lat, lon) {
        if (typeof window.setMyLocation === 'function') window.setMyLocation(lat, lon);
    }

    /* ── 5. PREFERENCE APPLICATION ───────────────────────────────────────── */

    // All filter checkbox IDs on the site
    const FILTER_IDS = [
        'show-aprs', 'show-cwop', 'show-ogn', 'show-objects', 'hide-static',
        'show-phg', 'ghostOld', 'cluster-enable', 'show-all-connections',
        'show-lora-aprsis', 'show-seamarks', 'show-ships', 'show-lora',
        'lora-show-igates', 'lora-show-digis', 'lora-show-trackers',
        'lora-show-direct', 'lora-show-digipeated',
        'mp-drop-pistar', 'mp-drop-dstar', 'mp-drop-apdesk'
    ];

    /** Read all filter checkboxes → save to settings (renderer → main process). */
    function captureFilters() {
        const captured = {};
        let found = 0;
        FILTER_IDS.forEach(id => {
            const cb = document.getElementById(id);
            if (cb && cb.type === 'checkbox') {
                captured[id] = cb.checked;
                found++;
            }
        });
        if (found > 0) {
            s.prefFilters = captured;
            ac.saveSettings({ prefFilters: captured });
        }
    }

    /**
     * Attach change listeners to all filter checkboxes so any user interaction
     * is immediately persisted via the IPC bridge.
     * Uses a sentinel flag so we never double-hook the same element.
     */
    function attachFilterListeners() {
        FILTER_IDS.forEach(id => {
            const cb = document.getElementById(id);
            if (cb && !cb.__aprsClientHooked) {
                cb.__aprsClientHooked = true;
                cb.addEventListener('change', captureFilters);
            }
        });
    }

    /** Push stored filter prefs → checkboxes, then ensure listeners are wired. */
    function applyPrefs() {
        // Theme: set directly via data-theme attribute (toggleTheme() exists but
        // flips state — safer to set the attribute absolutely).
        if (s.prefTheme) {
            const cur = document.documentElement.getAttribute('data-theme') || 'dark';
            if (cur !== s.prefTheme) {
                document.documentElement.setAttribute('data-theme', s.prefTheme);
            }
        }

        // Filters: push stored values → site checkboxes
        if (s.prefFilters && typeof s.prefFilters === 'object') {
            FILTER_IDS.forEach(id => {
                const cb = document.getElementById(id);
                if (cb && cb.type === 'checkbox' &&
                    typeof s.prefFilters[id] === 'boolean' &&
                    cb.checked !== s.prefFilters[id]) {
                    cb.checked = s.prefFilters[id];
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        }

        attachFilterListeners();
    }

    /* ── 6. DESKTOP SETTINGS PANEL ──────────────────────────────────────── */
    function openDesktopSettings() {
        const existing = document.getElementById('__aprs_settings_panel');
        if (existing) { existing.remove(); return; }

        const panel = document.createElement('div');
        panel.id = '__aprs_settings_panel';
        Object.assign(panel.style, {
            position: 'fixed', top: TB_H + 'px', right: '0', width: '320px',
            background: '#1e293b', border: '1px solid #334155',
            borderRadius: '0 0 0 12px', padding: '18px',
            zIndex: '2147483646', fontFamily: 'Segoe UI,sans-serif',
            fontSize: '13px', color: '#e2e8f0',
            boxShadow: '-4px 4px 20px rgba(0,0,0,0.5)'
        });

        const title = el('div', '\u2699 Desktop Settings', {
            fontWeight: '700', fontSize: '14px', color: '#38bdf8',
            marginBottom: '14px'
        });

        function row(label, input) {
            const r = document.createElement('div');
            r.style.cssText =
                'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
            r.append(el('span', label, { color: '#94a3b8' }), input);
            return r;
        }

        function toggle(key, val) {
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = !!val;
            cb.style.accentColor = '#38bdf8';
            cb.addEventListener('change', () => ac.saveSettings({ [key]: cb.checked }));
            return cb;
        }

        // Theme toggle row
        const themeLabel = el('span', 'Theme', { color: '#94a3b8' });
        const themeSel = document.createElement('select');
        Object.assign(themeSel.style, {
            background: '#0f172a', color: '#e2e8f0',
            border: '1px solid #334155', borderRadius: '4px', padding: '2px 6px'
        });
        ['dark', 'light'].forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v.charAt(0).toUpperCase() + v.slice(1);
            if ((s.prefTheme || 'dark') === v) o.selected = true;
            themeSel.appendChild(o);
        });
        themeSel.addEventListener('change', () => {
            const t = themeSel.value;
            ac.saveSettings({ prefTheme: t });
            document.documentElement.setAttribute('data-theme', t);
        });
        const themeRow = document.createElement('div');
        themeRow.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
        themeRow.append(themeLabel, themeSel);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        Object.assign(closeBtn.style, {
            marginTop: '8px', width: '100%',
            background: 'transparent', border: '1px solid #334155',
            borderRadius: '6px', color: '#e2e8f0', padding: '4px',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px'
        });
        closeBtn.addEventListener('click', () => panel.remove());

        panel.append(
            title,
            themeRow,
            row('Desktop notifications', toggle('notifications',   s.notifications)),
            row('Minimise to tray',      toggle('minimizeToTray',  s.minimizeToTray)),
            row('Launch on startup',     toggle('launchOnStartup', s.launchOnStartup)),
            row('Auto-connect',          toggle('autoConnect',     s.autoConnect)),
            closeBtn
        );
        document.body.appendChild(panel);

        setTimeout(() => {
            function outside(e) {
                if (!panel.contains(e.target)) {
                    panel.remove();
                    document.removeEventListener('click', outside);
                }
            }
            document.addEventListener('click', outside);
        }, 100);
    }

    /* ── INIT ────────────────────────────────────────────────────────────── */
    buildToolbar();
    hookNotifications();
    startGPS();

    /* Hook the site's WebSocket to intercept geo-fence alerts pushed by server */
    function hookWsAlerts() {
        var wsObj = window.ws || null;
        if (!wsObj || wsObj.readyState === undefined) { setTimeout(hookWsAlerts, 2000); return; }
        if (wsObj.__aprsOverlayAlertHooked) return;
        wsObj.__aprsOverlayAlertHooked = true;
        var _orig = wsObj.onmessage;
        wsObj.onmessage = function(e) {
            if (_orig) _orig.call(this, e);
            try {
                var d = JSON.parse(e.data);
                if (d.type === 'alert' && d.message) {
                    var title = d.alert_type === 'geofence_enter' ? '📍 Station entered zone'
                              : d.alert_type === 'geofence_exit'  ? '📍 Station left zone'
                              : '⚡ APRS Net Alert';
                    if (typeof ac !== 'undefined') ac.showNotification(title, d.message);
                    // Flash unread badge amber
                    var badge = document.getElementById('__aprs_unread_badge');
                    if (badge) {
                        badge.style.background = '#f97316';
                        badge.textContent = String((parseInt(badge.textContent)||0)+1);
                        badge.style.display = 'inline-block';
                    }
                }
            } catch(_) {}
        };
    }
    setTimeout(hookWsAlerts, 3000); // Wait for WS to open and member auth to complete

    /* ── 7. BLE RADIO (RT-950 PRO / KISS BLE) ─────────────────── */
    // Connects to a Radtel RT-950 Pro (or compatible BLE KISS radio) via
    // Bluetooth LE and feeds decoded APRS packets into the site renderer.
    // Protocol credit: mecta02/aprs (reverse-engineered BLE UUIDs)
    //   Service  : 0000FFE0-0000-1000-8000-00805F9B34FB
    //   Notify   : 0000FFE1-0000-1000-8000-00805F9B34FB  (RX)
    //   Framing  : KISS 0xC0/0xDB, L2: AX.25 UI ctrl=0x03 pid=0xF0

    const _BLE_SVC = '0000ffe0-0000-1000-8000-00805f9b34fb';
    const _BLE_RX  = '0000ffe1-0000-1000-8000-00805f9b34fb';
    const _FEND = 0xC0, _FESC = 0xDB, _TFEND = 0xDC, _TFESC = 0xDD;
    let _bleDev = null, _bleKissBuf = [], _blePktCount = 0;

    function _kissExtract(buf) {
        const frames = []; let fStart = -1;
        for (let i = 0; i <= buf.length; i++) {
            const b = i < buf.length ? buf[i] : _FEND;
            if (b === _FEND) {
                if (fStart >= 0 && i > fStart + 1) {
                    const raw = [];
                    for (let j = fStart + 1; j < i; j++) {
                        if (buf[j] === _FESC && j + 1 < i) {
                            j++;
                            raw.push(buf[j] === _TFEND ? _FEND : buf[j] === _TFESC ? _FESC : buf[j]);
                        } else { raw.push(buf[j]); }
                    }
                    if (raw.length >= 16) frames.push(Uint8Array.from(raw));
                }
                fStart = i;
            }
        }
        return { frames, tail: fStart >= 0 ? buf.slice(fStart) : buf.slice(-512) };
    }

    function _ax25toAPRS(frame) {
        if (!frame || frame.length < 17) return null;
        let off = 0;
        if ((frame[off] & 0x0F) !== 0x00) return null;
        off++;
        function decAddr(o) {
            let c = '';
            for (let i = 0; i < 6; i++) {
                const ch = (frame[o + i] >> 1) & 0x7F;
                if (ch > 0x20 && ch < 0x7F) c += String.fromCharCode(ch);
            }
            const sb = frame[o + 6];
            return { call: c.trim() + (((sb >> 1) & 0x0F) ? '-' + ((sb >> 1) & 0x0F) : ''), last: !!(sb & 0x01), hBit: !!(sb & 0x80) };
        }
        if (off + 14 > frame.length) return null;
        const dst = decAddr(off); off += 7;
        const src = decAddr(off); off += 7;
        const digis = []; let last = src.last;
        while (!last && off + 7 <= frame.length) {
            const dg = decAddr(off); off += 7;
            digis.push(dg.call + (dg.hBit ? '*' : ''));
            last = dg.last;
        }
        if (off + 2 > frame.length) return null;
        if (frame[off++] !== 0x03 || frame[off++] !== 0xF0) return null;
        const info = new TextDecoder('latin1').decode(frame.slice(off));
        if (!info.trim()) return null;
        return src.call + '>' + [dst.call, ...digis].join(',') + ':' + info;
    }

    function _parseMicEExtras(raw) {
        try {
            const ci = raw.indexOf(':'); if (ci < 0) return null;
            const pay = raw.slice(ci + 1);
            if ((pay[0] !== '`' && pay[0] !== "'") || pay.length < 7) return null;
            const spB = pay.charCodeAt(4) - 28, dcB = pay.charCodeAt(5) - 28, seB = pay.charCodeAt(6) - 28;
            let spd = spB * 10 + Math.floor(dcB / 10), hdg = (dcB % 10) * 100 + seB;
            if (spd >= 800) spd -= 800; if (hdg >= 400) hdg -= 400;
            const altM = pay.match(/([!-{]{3})\}/);
            let alt_m = null;
            if (altM) {
                const a = altM[1];
                alt_m = (a.charCodeAt(0)-33)*91*91 + (a.charCodeAt(1)-33)*91 + (a.charCodeAt(2)-33) - 10000;
            }
            return { spd_kmh: Math.round(spd * 1.852), hdg, alt_m };
        } catch (_) { return null; }
    }

    function _bleInject(raw) {
        if (!raw || raw.indexOf('>') < 1 || raw.indexOf(':') < 1) return;
        _blePktCount++; _bleUpdateBtn();
        if (typeof logChat === 'function') logChat('🔵', raw.substring(0, 80), 'text-cyan-400');
        if (typeof handleIncoming === 'function') handleIncoming({ type: 'rx', packet: raw });
        const ext = _parseMicEExtras(raw);
        if (ext) { const call = raw.substring(0, raw.indexOf('>')); window.__bleMicEExtras = window.__bleMicEExtras || {}; window.__bleMicEExtras[call] = ext; }
    }

    function _bleUpdateBtn() {
        const b = document.getElementById('__aprs_ble_btn'); if (!b) return;
        const conn = _bleDev && _bleDev.gatt && _bleDev.gatt.connected;
        b.textContent       = conn ? ('🔵 BLE (' + _blePktCount + ')') : '⚫ BLE';
        b.title             = conn ? ('BLE: ' + _bleDev.name + ' — ' + _blePktCount + ' pkts. Click to disconnect.') : 'Connect BLE radio (RT-950 Pro / KISS BLE)';
        b.style.borderColor = conn ? '#0ea5e9' : '#334155';
        b.style.color       = conn ? '#38bdf8' : '#e2e8f0';
    }

    function _bleOnData(e) {
        const bytes = Array.from(new Uint8Array(e.target.value.buffer));
        _bleKissBuf = _bleKissBuf.concat(bytes);
        if (_bleKissBuf.length > 16384) _bleKissBuf = _bleKissBuf.slice(-8192);
        const { frames, tail } = _kissExtract(_bleKissBuf);
        _bleKissBuf = tail;
        frames.forEach(function(f) { const p = _ax25toAPRS(f); if (p) _bleInject(p); });
    }

    async function _bleConnect() {
        if (!navigator.bluetooth) {
            if (typeof logChat === 'function') logChat('BLE', 'Web Bluetooth not available', 'text-red-400');
            return;
        }
        try {
            const dev = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'RT-950' }, { namePrefix: 'RT950' }, { services: [_BLE_SVC] }],
                optionalServices: [_BLE_SVC]
            });
            _bleDev = dev; _blePktCount = 0; _bleKissBuf = []; _bleUpdateBtn();
            dev.addEventListener('gattserverdisconnected', function() {
                _bleUpdateBtn();
                if (typeof logChat === 'function') logChat('BLE', 'Radio disconnected — reconnecting in 8 s…', 'text-yellow-400');
                setTimeout(async function() {
                    if (!_bleDev) return;
                    try {
                        const srv = await _bleDev.gatt.connect();
                        const svc = await srv.getPrimaryService(_BLE_SVC);
                        const chr = await svc.getCharacteristic(_BLE_RX);
                        chr.addEventListener('characteristicvaluechanged', _bleOnData);
                        await chr.startNotifications();
                        _bleUpdateBtn();
                        if (typeof logChat === 'function') logChat('BLE', 'Reconnected to ' + _bleDev.name, 'text-cyan-400');
                    } catch (_) { _bleUpdateBtn(); }
                }, 8000);
            });
            const server = await dev.gatt.connect();
            const svc    = await server.getPrimaryService(_BLE_SVC);
            const chr    = await svc.getCharacteristic(_BLE_RX);
            chr.addEventListener('characteristicvaluechanged', _bleOnData);
            await chr.startNotifications();
            _bleUpdateBtn();
            if (typeof logChat === 'function') logChat('BLE', 'Connected to ' + dev.name, 'text-cyan-400');
        } catch (err) {
            const msg = (err.message || String(err)).substring(0, 100);
            if (!msg.toLowerCase().includes('cancel') && !msg.includes('chosen')) {
                if (typeof logChat === 'function') logChat('BLE', 'Error: ' + msg, 'text-red-400');
            }
            _bleUpdateBtn();
        }
    }

    function _bleDisconnect() {
        if (_bleDev && _bleDev.gatt && _bleDev.gatt.connected) _bleDev.gatt.disconnect();
        _bleDev = null; _bleKissBuf = []; _blePktCount = 0; _bleUpdateBtn();
        if (typeof logChat === 'function') logChat('BLE', 'Disconnected', 'text-gray-400');
    }

    function toggleBLE() {
        if (_bleDev && _bleDev.gatt && _bleDev.gatt.connected) _bleDisconnect();
        else _bleConnect();
    }

    /* ── Net quick check-in ───────────────────────────────────────────────── */
    var KNOWN_NETS_DESKTOP = [
        { name:'APRS Thursday (HOTG)', schedule:'Every Thursday 00:00–23:59 UTC',
          destination:'ANSRVR', bodyPrefix:'CQ HOTG ', ansrvrGroup:'HOTG' },
        { name:'APRSPH Thursday',      schedule:'Every Thursday 00:00–23:59 UTC',
          destination:'APRSPH', bodyPrefix:'HOTG ',    ansrvrGroup:null },
        { name:'Hamfinity Sunday',     schedule:'Every Sunday 00:00–23:59 UTC',
          destination:'9M4GKS', bodyPrefix:'CQ Hamfinity ', ansrvrGroup:null },
        { name:'ANSRVR CQ',            schedule:'Any time',
          destination:'ANSRVR', bodyPrefix:'CQ ',      ansrvrGroup:null }
    ];

    var _desktopNetsOpen = false;
    var _desktopUnjoinGroup = null;

    function injectNetsButton() {
        // Only inject once; check the compose area is present
        if (document.getElementById('__aprs_nets_btn')) return;
        var sendBtn = document.getElementById('send-btn');
        var composeArea = document.getElementById('compose-area');
        if (!sendBtn || !composeArea) { setTimeout(injectNetsButton, 2000); return; }

        // Create the 📡 nets button
        var netsBtn = document.createElement('button');
        netsBtn.id = '__aprs_nets_btn';
        netsBtn.textContent = '📡';
        netsBtn.title = 'Net quick check-in';
        Object.assign(netsBtn.style, {
            flexShrink: '0', width: '36px', height: '36px', borderRadius: '10px',
            border: '1px solid #1e3a5f', background: '#0d2137', color: '#38bdf8',
            cursor: 'pointer', fontSize: '15px', display: 'flex',
            alignItems: 'center', justifyContent: 'center'
        });

        // Nets dropdown panel (injected below compose area)
        var dd = document.createElement('div');
        dd.id = '__aprs_nets_dd';
        dd.style.cssText = 'display:none;position:absolute;bottom:100%;left:0;right:0;z-index:999999;' +
            'background:#0b1e35;border:1px solid #1e3a5f;border-radius:12px 12px 0 0;' +
            'max-height:320px;overflow-y:auto;font-family:Segoe UI,sans-serif;';
        dd.innerHTML = '<div style="padding:8px 12px;font-size:12px;font-weight:700;color:#38bdf8;' +
            'border-bottom:1px solid #1e3a5f;">📡 Net Quick Check-in</div>' +
            KNOWN_NETS_DESKTOP.map(function(n, i) {
                return '<div style="padding:8px 12px;cursor:pointer;border-top:1px solid #0d1f36;"' +
                    ' onmouseenter="this.style.background=\'#0d2137\'" onmouseleave="this.style.background=\'\'"' +
                    ' onclick="window.__aprsNetsApply(' + i + ')">' +
                    '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                        '<span style="font-size:12px;font-weight:700;color:#38bdf8;">' + n.name + '</span>' +
                        '<span style="font-size:11px;font-weight:700;color:#f59e0b;">→ ' + n.destination + '</span>' +
                    '</div>' +
                    '<div style="font-size:10px;color:#64748b;">' + n.schedule + '</div>' +
                    '<div style="font-size:11px;color:#86efac;margin-top:2px;">"' + n.bodyPrefix + '…"</div>' +
                    (n.ansrvrGroup ? '<div style="font-size:10px;color:#475569;">Auto-unjoin prompt after ACK</div>' : '') +
                '</div>';
            }).join('');

        // Unjoin banner
        var ub = document.createElement('div');
        ub.id = '__aprs_unjoin';
        ub.style.cssText = 'display:none;padding:6px 12px;background:#14291a;border-bottom:1px solid #166534;' +
            'font-family:Segoe UI,sans-serif;display:none;align-items:center;gap:8px;';
        ub.innerHTML = '<span id="__aprs_uj_text" style="font-size:11px;color:#86efac;flex:1;"></span>' +
            '<button id="__aprs_uj_btn" style="font-size:11px;background:#166534;color:#86efac;' +
            'border:none;border-radius:8px;padding:3px 10px;cursor:pointer;font-weight:700;"></button>' +
            '<button onclick="window.__aprsUnjoinDismiss()" style="font-size:11px;background:none;' +
            'border:none;color:#64748b;cursor:pointer;">✕</button>';

        // Wrap compose area with relative positioning for the dropdown
        composeArea.style.position = 'relative';
        composeArea.insertBefore(dd, composeArea.firstChild);
        composeArea.insertBefore(ub, composeArea.firstChild);

        // Insert the button before the textarea
        var ta = document.getElementById('msgText');
        if (ta && ta.parentNode) {
            ta.parentNode.insertBefore(netsBtn, ta);
            var sp = document.createElement('div');
            sp.style.cssText = 'flex-shrink:0;width:6px;';
            ta.parentNode.insertBefore(sp, ta);
        }

        netsBtn.onclick = function() {
            _desktopNetsOpen = !_desktopNetsOpen;
            dd.style.display = _desktopNetsOpen ? 'block' : 'none';
        };

        window.__aprsNetsApply = function(idx) {
            var net = KNOWN_NETS_DESKTOP[idx];
            if (!net) return;
            if (typeof openConversation === 'function') openConversation(net.destination);
            setTimeout(function() {
                var ta2 = document.getElementById('msgText');
                if (ta2) { ta2.value = net.bodyPrefix; ta2.dispatchEvent(new Event('input')); ta2.focus(); }
            }, 150);
            dd.style.display = 'none';
            _desktopNetsOpen = false;
        };

        window.__aprsUnjoinDismiss = function() {
            _desktopUnjoinGroup = null;
            var u = document.getElementById('__aprs_unjoin');
            if (u) u.style.display = 'none';
        };
    }

    /* Intercept incoming WS messages to detect ANSRVR check-in ACK */
    function hookWsForUnjoin() {
        var wsObj = window.ws || null;
        if (!wsObj || wsObj.readyState === undefined) { setTimeout(hookWsForUnjoin, 2000); return; }
        if (wsObj.__aprsOverlayUnjoinHooked) return;
        wsObj.__aprsOverlayUnjoinHooked = true;
        var _orig2 = wsObj.onmessage;
        wsObj.onmessage = function(e) {
            if (_orig2) _orig2.call(this, e);
            try {
                var d = JSON.parse(e.data);
                if (d.type === 'rx' && d.packet) {
                    var pkt = d.packet;
                    var gt = pkt.indexOf('>'), col = pkt.indexOf(':');
                    if (gt > 0 && col > gt) {
                        var from = pkt.substring(0, gt).trim().toUpperCase();
                        var body = pkt.substring(col + 1);
                        // Is this a message addressed to us from ANSRVR?
                        if (from === 'ANSRVR' && /^:[A-Z0-9 \-]{9}:/.test(body) &&
                            !_desktopUnjoinGroup && body.indexOf('ack') === -1) {
                            // Look at last outgoing CQ in conversations
                            var conv = (typeof _conversations !== 'undefined' && _conversations['ANSRVR']) || [];
                            for (var i = conv.length - 1; i >= 0; i--) {
                                if (conv[i].out) {
                                    var m2 = /^CQ\s+(\S+)/i.exec((conv[i].text || '').trim());
                                    if (m2) {
                                        _desktopUnjoinGroup = m2[1].toUpperCase();
                                        var ub2 = document.getElementById('__aprs_unjoin');
                                        var txt = document.getElementById('__aprs_uj_text');
                                        var ubtn = document.getElementById('__aprs_uj_btn');
                                        if (ub2 && txt && ubtn) {
                                            txt.textContent = '✅ Checked in to ' + _desktopUnjoinGroup + ' — unjoin when done?';
                                            ubtn.textContent = 'U ' + _desktopUnjoinGroup;
                                            ubtn.onclick = function() {
                                                if (typeof openConversation === 'function') openConversation('ANSRVR');
                                                setTimeout(function() {
                                                    var ta3 = document.getElementById('msgText');
                                                    if (ta3) { ta3.value = 'U ' + _desktopUnjoinGroup; }
                                                    if (typeof sendMsg === 'function') sendMsg();
                                                }, 150);
                                                window.__aprsUnjoinDismiss();
                                            };
                                            ub2.style.display = 'flex';
                                        }
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch(_) {}
        };
    }

    setTimeout(injectNetsButton, 2500);
    setTimeout(hookWsForUnjoin, 4000);

    // Apply preferences once the site has rendered its controls
    setTimeout(() => { applyPrefs(); }, 1500);
    // Re-apply after member panel may have loaded (mp-* checkboxes)
    setTimeout(() => { applyPrefs(); }, 4000);
    // Re-attach filter listeners periodically in case the site re-renders controls
    setInterval(attachFilterListeners, 8000);

    // Auto member login — slight delay so the site's WS auth completes first
    setTimeout(tryMemberLogin, 2000);

})();
