/**
 * APRS Client - desktop overlay
 * Injected by main.js into every aprsnet.uk page after load.
 * Adds: desktop toolbar, auto member login, OS notifications,
 *       GPS forwarding and preference application.
 */
(async function () {
    'use strict';
    if (window.__aprsClientOverlay) return;
    window.__aprsClientOverlay = true;

    const ac = window.aprsClient;
    if (!ac) return;

    const s = await ac.getSettings();
    ac.onSettings(ns => Object.assign(s, ns));

    /* â”€â”€ 1. TOOLBAR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    const TB_H = 36;
    function buildToolbar() {
        // Push page content down so toolbar doesn't overlap
        document.documentElement.style.paddingTop = TB_H + 'px';

        const tb = document.createElement('div');
        tb.id = '__aprs_tb';
        Object.assign(tb.style, {
            position:   'fixed', top: '0', left: '0', right: '0',
            height:     TB_H + 'px', zIndex: '2147483647',
            background: '#0c1527', borderBottom: '1px solid #1e3a5f',
            display:    'flex', alignItems: 'center',
            padding:    '0 12px', gap: '10px', fontFamily: 'Segoe UI,sans-serif',
            fontSize:   '12px', userSelect: 'none', WebkitAppRegion: 'drag'
        });

        // Logo
        const logo = el('span', 'ðŸ“¡ APRS Client', { color:'#38bdf8', fontWeight:'700',
            fontSize:'13px', letterSpacing:'-0.3px', marginRight:'4px' });

        // Callsign badge
        const callBadge = el('span', s.callsign || '(no callsign)', {
            background:'#1e3a5f', border:'1px solid #2563eb', color:'#60a5fa',
            padding:'2px 10px', borderRadius:'20px', fontWeight:'700',
            fontSize:'11px', letterSpacing:'0.4px'
        });
        tb.callBadge = callBadge;

        // WS state indicator
        const wsDot = el('span', 'â—', { color:'#475569', title:'WebSocket state',
            fontSize:'14px', lineHeight:'1' });
        tb.wsDot = wsDot;

        // GPS indicator
        const gpsDot = el('span', 'ðŸ“', { color:'#475569', title:'GPS',
            fontSize:'12px', cursor:'default', WebkitAppRegion:'no-drag' });
        tb.gpsDot = gpsDot;

        // Unread badge
        const unread = el('span', '', {
            background:'#ef4444', color:'#fff', borderRadius:'10px',
            padding:'1px 7px', fontSize:'10px', fontWeight:'700',
            display:'none', WebkitAppRegion:'no-drag'
        });
        tb.unreadBadge = unread;

        // Spacer
        const spacer = el('div', '', { flex:'1' });

        // Settings button
        const settingsBtn = btn('âš™', 'Desktop settings', () => openDesktopSettings());

        // Disconnect button
        const discBtn = btn('âœ• Disconnect', 'Return to connect screen',
            () => ac.goBack(), '#dc2626');

        tb.append(logo, callBadge, wsDot, gpsDot, unread, spacer, settingsBtn, discBtn);
        document.body.appendChild(tb);

        // Update WS state every second
        setInterval(() => {
            const call = s.callsign || (window.myCallsign) || '';
            if (call) callBadge.textContent = call;
            // Try to read WS state from site globals
            const st = window._wsState || '';
            wsDot.style.color =
                st === 'authed'  ? '#4ade80' :
                st === 'open'    ? '#facc15' :
                st === 'closed'  ? '#ef4444' : '#475569';
            wsDot.title = 'WebSocket: ' + (st || 'unknown');
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
        b.textContent = text;
        b.title = title;
        Object.assign(b.style, {
            background:    bg || 'transparent',
            border:        bg ? 'none' : '1px solid #334155',
            borderRadius:  '6px', color: '#e2e8f0',
            padding:       '3px 10px', fontSize: '11px',
            cursor:        'pointer', fontFamily: 'inherit',
            WebkitAppRegion: 'no-drag', transition: 'background 0.15s'
        });
        b.addEventListener('click', onClick);
        b.addEventListener('mouseenter', () =>
            b.style.background = bg ? bg + 'cc' : '#1e293b');
        b.addEventListener('mouseleave', () =>
            b.style.background = bg || 'transparent');
        return b;
    }

    /* â”€â”€ 2. MEMBER AUTO-LOGIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    async function tryMemberLogin() {
        if (!s.memberUser || !s.memberPass) return;
        if (!s.autoMemberLogin) return;
        try {
            const r = await fetch('/api/member/login', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ callsign: s.memberUser, password: s.memberPass })
            });
            const d = await r.json();
            if (!d.token) return;
            window.__memberToken = d.token;
            // Persist token into the site's member store if available
            if (typeof window.onMemberLoginSuccess === 'function') {
                window.onMemberLoginSuccess(d);
            }
            // Update callsign in toolbar if server returned one
            if (d.callsign && document.getElementById('__aprs_tb')) {
                document.getElementById('__aprs_tb').callBadge.textContent = d.callsign;
            }
        } catch (_) {}
    }

    /* â”€â”€ 3. DESKTOP NOTIFICATION HOOK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    let _lastNotifiedMsgTs = 0;

    function hookNotifications() {
        // Wrap site's logChat function; fires desktop notification for
        // real incoming messages (not ACKs, not our own outgoing).
        function tryHook(attempts) {
            if (typeof window.logChat === 'function') {
                const orig = window.logChat;
                window.logChat = function (from, text, cls) {
                    const myCall = s.callsign || window.myCallsign || '';
                    // Only notify for messages from other stations, not ACKs or
                    // system/chat log entries (those have from='' or from contains our call)
                    if (from && typeof text === 'string' &&
                        !text.toLowerCase().startsWith('ack') &&
                        from.toUpperCase() !== myCall.toUpperCase() &&
                        from.length > 2) {
                        const now = Date.now();
                        if (now - _lastNotifiedMsgTs > 2000) {   // debounce 2s
                            _lastNotifiedMsgTs = now;
                            const body = text.replace(/[\r\n]+/g, ' ').substring(0, 120);
                            ac.showNotification(from + ' â†’ ' + (myCall || 'APRS'), body);
                            // Update unread count in toolbar
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

    /* â”€â”€ 4. GPS REPORTING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
                const fix = { lat: pos.coords.latitude, lon: pos.coords.longitude,
                              accuracy: pos.coords.accuracy };
                ac.reportPosition(fix);
                injectMyLocation(fix.lat, fix.lon);
                if (tb && tb.gpsDot) {
                    tb.gpsDot.style.color = '#4ade80';
                    tb.gpsDot.title = 'GPS fix: ' + fix.lat.toFixed(4) + ', ' + fix.lon.toFixed(4);
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
        // If the site exposes a setMyLocation hook, use it; otherwise no-op
        if (typeof window.setMyLocation === 'function') {
            window.setMyLocation(lat, lon);
        }
    }

    /* â”€â”€ 5. PREFERENCE APPLICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    function applyPrefs() {
        // Theme
        if (s.prefTheme) {
            try {
                const themeBtn = document.querySelector('[data-theme-toggle],[onclick*="theme"],[id*="theme"]');
                if (themeBtn) {
                    const cur = document.documentElement.getAttribute('data-theme') || '';
                    if (cur !== s.prefTheme) themeBtn.click();
                }
            } catch (_) {}
        }
        // Filters
        if (s.prefFilters && typeof s.prefFilters === 'object') {
            for (const [id, val] of Object.entries(s.prefFilters)) {
                const cb = document.getElementById(id);
                if (cb && cb.type === 'checkbox' && cb.checked !== !!val) {
                    cb.checked = !!val;
                    cb.dispatchEvent(new Event('change'));
                }
            }
        }
    }

    /* â”€â”€ 6. MINI DESKTOP-SETTINGS PANEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    function openDesktopSettings() {
        if (document.getElementById('__aprs_settings_panel')) {
            document.getElementById('__aprs_settings_panel').remove();
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = '__aprs_settings_panel';
        Object.assign(overlay.style, {
            position:'fixed', top: TB_H + 'px', right:'0', width:'320px',
            background:'#1e293b', border:'1px solid #334155',
            borderRadius:'0 0 0 12px', padding:'18px',
            zIndex:'2147483646', fontFamily:'Segoe UI,sans-serif',
            fontSize:'13px', color:'#e2e8f0', boxShadow:'-4px 4px 20px rgba(0,0,0,0.5)'
        });

        const title = el('div', 'âš™ Desktop Settings', {
            fontWeight:'700', fontSize:'14px', color:'#38bdf8', marginBottom:'14px'
        });

        function row(label, inputEl) {
            const r = document.createElement('div');
            r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
            const l = el('span', label, { color:'#94a3b8' });
            r.append(l, inputEl);
            return r;
        }

        function toggle(key, val) {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!val;
            cb.style.accentColor = '#38bdf8';
            cb.addEventListener('change', () => ac.saveSettings({ [key]: cb.checked }));
            return cb;
        }

        const notifRow  = row('Desktop notifications', toggle('notifications',  s.notifications));
        const trayRow   = row('Minimise to tray',      toggle('minimizeToTray', s.minimizeToTray));
        const startupRow= row('Launch on startup',     toggle('launchOnStartup',s.launchOnStartup));
        const autoRow   = row('Auto-connect',          toggle('autoConnect',    s.autoConnect));

        const closeBtn = btn('Close', 'Close settings', () => overlay.remove());
        closeBtn.style.marginTop = '8px';
        closeBtn.style.width = '100%';

        overlay.append(title, notifRow, trayRow, startupRow, autoRow, closeBtn);
        document.body.appendChild(overlay);

        // Close on click outside
        setTimeout(() => {
            function outsideClick(e) {
                if (!overlay.contains(e.target) && e.target.id !== '__aprs_tb') {
                    overlay.remove();
                    document.removeEventListener('click', outsideClick);
                }
            }
            document.addEventListener('click', outsideClick);
        }, 100);
    }

    /* â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    buildToolbar();
    hookNotifications();
    startGPS();
    applyPrefs();

    // Slight delay: let the site finish rendering before auto-login
    setTimeout(tryMemberLogin, 1500);
    // Re-apply filters after site filters may have reset
    setTimeout(applyPrefs, 3000);

})();