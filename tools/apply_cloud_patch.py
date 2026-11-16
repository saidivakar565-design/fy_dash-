import re,hashlib,base64,sys
p='index.html'
s=open(p,encoding='utf-8').read()
def h(x): return "'sha256-"+base64.b64encode(hashlib.sha256(x.encode()).digest()).decode()+"'"
old_scripts=[m.group(1) for m in re.finditer(r'<script>(.*?)</script>',s,re.S)]
def rep(a,b,cnt=1):
    global s
    c=s.count(a)
    assert c==cnt,(c,a[:80])
    s=s.replace(a,b)
VPS="wss://srv2165780.hstgr.cloud/ws"
# --- inline script edits ---
rep("function defaultWsUrl(){ const h=location.hostname||''; if(!h ||",
    "function defaultWsUrl(){ const h=location.hostname||''; if(h && !/^(127\\.0\\.0\\.1|localhost|\\[?::1\\]?)$/i.test(h) && window.VPSB) return VPSB.ws;  // phone/GitHub Pages: cloud OpenAlgo (Hostinger VPS)\n  if(!h ||")
rep("function fyDefaultSource(){ const h=location.hostname||'';\n",
    "function fyDefaultSource(){ const h=location.hostname||''; if(window.VPSB) return 'openalgo';  // Fyers direct would log out the cloud OpenAlgo server (one login per Fyers app)\n")
rep("  tok(){ return lsGet(FY_TOK); },\n  valid(){ const t=this.tok();",
    "  tok(){ if(window.VPSB && VPSB.active()) return VPSB.tok(); return lsGet(FY_TOK); },  // cloud OpenAlgo serves Fyers history (js/vps_bridge.js)\n  valid(){ if(window.VPSB && VPSB.active()) return true; const t=this.tok();")
rep("if(!fy){ pill.className='lvpill'; pill.textContent='Source: OpenAlgo (laptop)'; }",
    "if(!fy){ pill.className='lvpill'+(LiveFeed.ws?' ok':''); pill.textContent='Source: Cloud OpenAlgo'; }")
rep("$('fysrc').onclick=e=>{ const b=e.target.closest('button[data-v]'); if(!b || b.dataset.v===FyCfg.source) return;",
    "$('fysrc').onclick=e=>{ const b=e.target.closest('button[data-v]'); if(!b || b.dataset.v===FyCfg.source) return;\n    if(b.dataset.v==='fyers' && !confirm('Fyers direct logs in to Fyers from this phone and LOGS OUT the cloud OpenAlgo server (and Market Radar): your Fyers app allows one login at a time. Switch anyway?')) return;")
rep("const FYMODE = () => FyCfg.source==='fyers';",
    "if(window.VPSB && FyCfg.source==='fyers'){ FyCfg.source='openalgo'; }\nconst FYMODE = () => FyCfg.source==='fyers';")
# block 7363 fyAuth
rep('function fyAuth(){var c=(typeof FyCfg!=="undefined"&&FyCfg&&FyCfg.appId)?{appId:FyCfg.appId}:(lj("fy_cfg")||{});',
    'function fyAuth(){if(window.VPSB&&VPSB.active()) return {h:"cloud:openalgo"};  /* cloud OpenAlgo via js/vps_bridge.js */\n  var c=(typeof FyCfg!=="undefined"&&FyCfg&&FyCfg.appId)?{appId:FyCfg.appId}:(lj("fy_cfg")||{});')
# --- HTML text ---
rep('<button data-v="fyers" type="button">Fyers direct · phone, no laptop</button><button data-v="openalgo" type="button">OpenAlgo · laptop at home</button>',
    '<button data-v="openalgo" type="button">Cloud OpenAlgo · srv2165780.hstgr.cloud</button><button data-v="fyers" type="button" style="display:none" title="Disabled: logs out the cloud server">Fyers direct (off)</button>')
rep('<div id="oabox" class="note" style="margin-top:10px;display:none"><b>OpenAlgo mode</b> uses OpenAlgo on your laptop (laptop must be on and logged in to Fyers). If this page is opened from an <code>https://</code> address, the browser only allows a <code>wss://</code> WebSocket URL; at home it is simpler to open your Market Radar link from the laptop.</div>',
    '<div id="oabox" class="note" style="margin-top:10px;display:none"><b>Cloud OpenAlgo</b> on your Hostinger server (<code>srv2165780.hstgr.cloud</code>) feeds live ticks, candles, the Daily board, charts and SHN signals. Works on mobile data, no laptop needed. Do your one daily Fyers login on the server (OpenAlgo web page); this phone never logs in to Fyers itself.</div>')
rep('<h2>OpenAlgo connection (laptop)</h2>','<h2>Cloud OpenAlgo connection</h2>')
rep('<div class="note"><b>Ready to connect.</b> If OpenAlgo is running on the <b>same computer</b> as this file, use <code>ws://127.0.0.1:8765</code> (pre-filled).',
    '<div class="note"><b>One-time setup:</b> WebSocket URL <code>wss://srv2165780.hstgr.cloud/ws</code> is pre-filled. Paste the API key from <b>srv2165780.hstgr.cloud → API Key</b>, keep Auto-connect ticked and press Connect. (Laptop OpenAlgo: <code>ws://127.0.0.1:8765</code>.)')
rep('<title>Cockpit · Fyers live</title>','<title>Cockpit · Cloud OpenAlgo</title>')
# --- recompute hashes ---
new_scripts=[m.group(1) for m in re.finditer(r'<script>(.*?)</script>',s,re.S)]
assert len(new_scripts)==len(old_scripts)
changed=0
for o,nw in zip(old_scripts,new_scripts):
    if o!=nw:
        rep(h(o),h(nw)); changed+=1
print('changed inline scripts',changed)
# --- CSP connect-src ---
rep("connect-src 'self' https://api-t1.fyers.in","connect-src 'self' https://srv2165780.hstgr.cloud wss://srv2165780.hstgr.cloud https://api-t1.fyers.in")
# --- script tags ---
rep('<link rel="manifest" href="manifest.webmanifest">','<link rel="manifest" href="manifest.webmanifest">\n<script src="js/vps_bridge.js?v=20261116"></script>')
rep('<script src="js/shn_app.js"></script>','<script src="js/shn_app.js"></script>\n<script src="js/vps_pro.js?v=20261116"></script>')
open(p,'w',encoding='utf-8').write(s)
# verify
for m in re.finditer(r'<script>(.*?)</script>',s,re.S):
    assert h(m.group(1)) in s[:20000]
print('ok')
