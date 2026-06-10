/**
 * APRS Client - desktop overlay v1.2.1
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
        tb.unreadBadge = unread;

        const spacer = el('div', '', { flex: '1' });
        const settingsBtn = btn('\u2699', 'Desktop settings', () => openDesktopSettings());
        const discBtn = btn('\u2715 Disconnect', 'Return to connect screen',
            () => ac.goBack(), '#dc2626');

        tb.append(logo, callBadge, wsDot, gpsDot, unread, spacer, settingsBtn, discBtn);
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
                    const myCall = s.callsign || window.myCallsign || '';
                    if (from && typeof text === 'string' &&
                        !text.toLowerCase().startsWith('ack') &&
                        from.toUpperCase() !== myCall.toUpperCase() &&
                        from.length > 2) {
                        const now = Date.now();
                        if (now - _lastNotifiedTs > 2000) {
                            _lastNotifiedTs = now;
                            ac.showNotification(
                                from + ' \u2192 ' + (myCall || 'APRS'),
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

    // Apply preferences once the site has rendered its controls
    setTimeout(() => { applyPrefs(); }, 1500);
    // Re-apply after member panel may have loaded (mp-* checkboxes)
    setTimeout(() => { applyPrefs(); }, 4000);
    // Re-attach filter listeners periodically in case the site re-renders controls
    setInterval(attachFilterListeners, 8000);

    // Auto member login — slight delay so the site's WS auth completes first
    setTimeout(tryMemberLogin, 2000);

})();
