/* CSV / Excel downloads for the PRO sheet (17 Nov 2026).  READ-ONLY.
   window.CKDL.get(path, fallbackName) → fetch https://srv2165780.hstgr.cloud<path> with the X-API-KEY header (key from localStorage via
   window.VPSB, never in the URL), turn the reply into a Blob and save it with <a download> — works in Android Chrome, desktop browsers,
   and falls back to opening the file on iOS Safari.  Also adds a download bar to the PRO → Bots tab (/cockpit/bots/export). No key in this repo. */
(function () {
  'use strict';
  var d = document, T0 = Date.now();
  function $(id) { return d.getElementById(id); }
  function ymd(ms) { var x = new Date(ms + 19800000); return x.toISOString().slice(0, 10); }
  var DL = window.CKDL = {
    get: function (path, fallback, btn) {
      var V = window.VPSB;
      if (!V || !V.key()) { alert('Save the Cloud OpenAlgo API key on the Live feed tab first.'); return Promise.resolve(); }
      var old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '…'; }
      return fetch(V.base + path, { method: 'GET', headers: { 'X-API-KEY': V.key() }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) return r.text().then(function (t) { var m = t; try { m = JSON.parse(t).message || t; } catch (e) {} throw new Error(m || ('HTTP ' + r.status)); });
          var cd = r.headers.get('Content-Disposition') || '', m = /filename="?([^";]+)"?/i.exec(cd), name = (m && m[1]) || fallback;
          return r.blob().then(function (b) { DL.save(b, name); return name; });
        })
        .catch(function (e) { alert('Download failed: ' + e.message); })
        .then(function (n) { if (btn) { btn.disabled = false; btn.textContent = old; } return n; });
    },
    save: function (blob, name) {
      var url = URL.createObjectURL(blob), a = d.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none'; d.body.appendChild(a);
      var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('download' in HTMLAnchorElement.prototype);
      if (ios) window.open(url, '_blank'); else a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 60000);
    }
  };

  /* Bots tab download bar */
  function bots() {
    var sec = $('pv-bots'), body = $('pvb-bots');
    if (!sec || !body) { if (Date.now() - T0 < 30000) return setTimeout(bots, 400); return; }
    if ($('botsDl')) return;
    var s = d.createElement('style');
    s.textContent = '.ckdl{display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:7px 8px;margin:0 0 8px;font-size:12px}' +
      '.ckdl b{font-size:12px;color:#8b949e;font-weight:600}.ckdl select{background:#0d1117;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px;font-size:13px}' +
      '.ckdl .btn{background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:7px 11px;font:700 12px system-ui;cursor:pointer}.ckdl .btn.x{background:#1a7f37;border-color:#2ea043}';
    d.head.appendChild(s);
    var bar = d.createElement('div'); bar.className = 'ckdl'; bar.id = 'botsDl';
    bar.innerHTML = '<b>⬇ Signal log</b>' +
      '<select id="botsDlBot"><option value="">All bots</option><option value="sdrainbow">SD Rainbow</option><option value="shn">SHN v3.4</option><option value="pro">Pro Screener</option><option value="radar">Market Radar</option></select>' +
      '<select id="botsDlRng"><option value="7">Last 7 days</option><option value="0">Today</option><option value="30">Last 30 days</option><option value="all">All</option></select>' +
      '<button class="btn" type="button" data-f="csv">CSV</button><button class="btn x" type="button" data-f="xlsx">Excel</button>';
    body.parentNode.insertBefore(bar, body);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]'); if (!b) return;
      var f = b.dataset.f, bot = $('botsDlBot').value, rg = $('botsDlRng').value, q = ['fmt=' + f];
      if (bot) q.push('bot=' + bot);
      if (rg !== 'all') { q.push('from=' + ymd(Date.now() - (+rg) * 86400000)); q.push('to=' + ymd(Date.now())); }
      DL.get('/cockpit/bots/export?' + q.join('&'), 'signals_' + ymd(Date.now()) + '.' + f, b);
    });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', bots); else bots();
})();
