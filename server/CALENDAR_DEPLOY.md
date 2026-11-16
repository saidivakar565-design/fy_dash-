# Auto-updating calendar on the VPS (PROPOSED — not deployed)

Waiting for Dhiva's confirmation. Nothing below has been run on the server.

## 1. Install the builder
    cp server/calendar_build.py /root/cockpit_bridge/calendar_build.py
    cp /root/cockpit_bridge/bridge.py /root/backups/bridge.py.$(date +%Y%m%d%H%M)       # backup first
    python3 /root/cockpit_bridge/calendar_build.py --out /root/cockpit_bridge/calendar.json   # first build (uses bridge.contracts())

## 2. Cron (every 30 min; ForexFactory asks for light polling)
    */30 * * * * cd /root/cockpit_bridge && flock -n /tmp/cal.lock python3 calendar_build.py --out /root/cockpit_bridge/calendar.json >> /root/cockpit_bridge/calendar.log 2>&1

## 3. Bridge endpoint (add inside H.do_GET, after the key check, next to /cockpit/contracts)
    if p == '/cockpit/calendar':
        with open('/root/cockpit_bridge/calendar.json') as f:
            j = json.load(f)
        j['file_mtime_ist'] = datetime.fromtimestamp(os.path.getmtime('/root/cockpit_bridge/calendar.json'), IST).strftime('%Y-%m-%d %H:%M IST')
        return self.send(200, j)
Then `systemctl restart cockpit-bridge`. No nginx change: /cockpit/ is already proxied with github.io CORS.

## 4. Front end
js/cleanup_v1.js already asks GET /cockpit/calendar first (with the key header) and falls back to data/calendar.json.

## Sources and limits
- ForexFactory weekly feed (this week only): US data, China data, FOMC minutes, Fed speakers, EIA crude + gas storage with forecasts.
- Fixed official dates checked 16 Nov 2026: FOMC 8–9 Dec (decision 00:30 IST Thu 10 Dec), RBI MPC decision 4 Dec 10:00 IST,
  BLS NFP 4 Dec + CPI 10 Dec (19:00 IST), PPI 15 Dec, OPEC+ ministerial 29 Nov (time TBC). Update this list each quarter.
- API (Tue 16:30 ET), EIA crude (Wed 10:30 ET), EIA gas (Thu 10:30 ET) are rule-based beyond this week; moved a day earlier on US holidays.
- MCX expiries come from the OpenAlgo symbol master, grouped per day, at the real session close (23:55 IST in US winter, 23:30 in US summer).
- Not covered automatically: LME (no free schedule feed), China data beyond the current week, OPEC MOMR / IEA OMR monthly reports.
