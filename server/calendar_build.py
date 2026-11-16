#!/usr/bin/env python3
"""MCX cockpit calendar builder (DRAFT — proposed for the VPS, not deployed).
Builds calendar.json in the cockpit's existing schema {updated,tz,source,events[{id,title,when,impact,assets,note}]}.
Sources:
  1. ForexFactory weekly feed (nfs.faireconomy.media/ff_calendar_thisweek.json): US/China/EU data, EIA crude + natgas, FOMC minutes, Fed speakers.
     Polled at most every 30 min (feed asks for light use).
  2. Official fixed schedules (verified 16 Nov 2026): FOMC (federalreserve.gov), RBI MPC (rbi.org.in), BLS CPI/NFP/PPI (bls.gov), OPEC+ (opec.org).
  3. Rule-based weekly energy prints for the next 6 weeks (API Tue 16:30 ET, EIA crude Wed 10:30 ET, EIA gas Thu 10:30 ET); a feed entry on the
     same day replaces the rule-based one.
  4. MCX expiries for the cockpit's contracts (from the bridge's contracts() → OpenAlgo symbol master; or --contracts-url).
Past events are kept for 21 days so charts can still mark them.
Usage: calendar_build.py --out /root/cockpit_bridge/calendar.json [--contracts-url URL --key-env OPENALGO_VPS_API_KEY]
"""
import json, os, sys, argparse, urllib.request, datetime as dt
from zoneinfo import ZoneInfo
ET, IST = ZoneInfo('America/New_York'), ZoneInfo('Asia/Kolkata')
FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
METALS = ['GOLD', 'SILVER']; BASE = ['COPPER', 'ZINC', 'ALUMINIUM', 'LEAD', 'NICKEL']; ENERGY = ['CRUDEOIL', 'NATURALGAS']
ALL = METALS + ENERGY + BASE

def et(y, m, d, hh, mm): return dt.datetime(y, m, d, hh, mm, tzinfo=ET)
def ist(y, m, d, hh, mm): return dt.datetime(y, m, d, hh, mm, tzinfo=IST)
def iso(t): return t.astimezone(IST).isoformat(timespec='seconds')

# ---- verified fixed schedule (update each year; sources in note) ----
FIXED = [
  ('fomc-2026-12-09', 'FOMC rate decision + projections (SEP)', et(2026, 12, 9, 14, 0), 'high', METALS + ENERGY + BASE, 'Fed decision 2:00 pm ET (00:30 IST Thu); presser 2:30 pm ET. Source: federalreserve.gov'),
  ('fomc-min-2026-12-30', 'FOMC minutes (Dec meeting)', et(2026, 12, 30, 14, 0), 'med', METALS, 'Source: federalreserve.gov'),
  ('rbi-2026-12-04', 'RBI MPC policy decision', ist(2026, 12, 4, 10, 0), 'high', ['NIFTY', 'BANKNIFTY', 'USDINR', 'GOLD'], 'Repo rate + stance 10:00 IST; Governor presser ~10:45. Source: rbi.org.in'),
  ('opec-2026-11-29', 'OPEC+ ministerial meeting (2027 quotas)', ist(2026, 11, 29, 15, 30), 'high', ['CRUDEOIL', 'CRUDEOILM'], 'Sunday meeting; time TBC (usually afternoon IST). Expect a Monday gap risk. Source: opec.org'),
  ('us-nfp-2026-12-04', 'US NFP + unemployment (Nov)', et(2026, 12, 4, 8, 30), 'high', ALL + ['NIFTY'], 'Source: bls.gov'),
  ('us-cpi-2026-12-10', 'US CPI (Nov)', et(2026, 12, 10, 8, 30), 'high', ALL + ['NIFTY'], 'Source: bls.gov'),
  ('us-ppi-2026-12-15', 'US PPI (Nov)', et(2026, 12, 15, 8, 30), 'med', METALS, 'Source: bls.gov'),
  ('us-jolts-2026-12-01', 'US JOLTS job openings (Oct)', et(2026, 12, 1, 10, 0), 'med', METALS, 'Source: bls.gov'),
  ('us-thanksgiving-2026-11-26', 'US Thanksgiving — COMEX/NYMEX closed, thin MCX evening', et(2026, 11, 26, 9, 0), 'med', ALL, 'MCX evening session follows a closed US market: wide spreads, weak follow-through.'),
  ('us-cpi-2027-01-13', 'US CPI (Dec)', et(2027, 1, 13, 8, 30), 'high', ALL + ['NIFTY'], 'Source: bls.gov'),
  ('us-nfp-2027-01-08', 'US NFP + unemployment (Dec)', et(2027, 1, 8, 8, 30), 'high', ALL + ['NIFTY'], 'Source: bls.gov'),
]
US_HOLIDAYS = {dt.date(2026, 11, 26), dt.date(2026, 12, 25), dt.date(2027, 1, 1)}

def weekly_rules(today, weeks=6):
    out = []; monday = today - dt.timedelta(days=today.weekday())
    for w in range(weeks):
        mo = monday + dt.timedelta(weeks=w)
        for title, wd, hh, mm, imp, assets, tag in [
            ('API weekly crude stocks', 1, 16, 30, 'med', ['CRUDEOIL', 'CRUDEOILM'], 'api'),
            ('EIA weekly crude inventories', 2, 10, 30, 'high', ['CRUDEOIL', 'CRUDEOILM'], 'eia-crude'),
            ('EIA natural gas storage', 3, 10, 30, 'high', ['NATURALGAS', 'NATGASMINI'], 'eia-gas')]:
            d = mo + dt.timedelta(days=wd); hol = d in US_HOLIDAYS
            if hol: d -= dt.timedelta(days=1); hh, mm = (12, 0) if tag == 'eia-gas' else (hh, mm)   # release moves a day earlier when it lands on a US holiday
            out.append(dict(id=f'{tag}-{d.isoformat()}', title=title, when=iso(et(d.year, d.month, d.day, hh, mm)), impact=imp, assets=assets,
                            note=('Rule-based; moved a day earlier for the US holiday (EIA confirms the week before). ' if hol else 'Rule-based; confirmed by the live feed during the week.'), _rule=tag))
    return out

def ff_assets(e):
    t, c = e['title'].lower(), e['country']
    if 'crude oil inventories' in t: return ['CRUDEOIL', 'CRUDEOILM'], 'high', 'eia-crude'
    if 'natural gas storage' in t: return ['NATURALGAS', 'NATGASMINI'], 'high', 'eia-gas'
    imp = {'High': 'high', 'Medium': 'med'}.get(e['impact'])
    if c == 'USD' and imp: return ALL + ['NIFTY'] if imp == 'high' else METALS + ['NIFTY'], imp, None
    if c == 'CNY' and imp: return ['COPPER', 'ZINC', 'ALUMINIUM', 'NICKEL', 'LEAD', 'CRUDEOIL', 'SILVER'], imp, None
    if c == 'EUR' and imp == 'high': return METALS, 'med', None
    return None, None, None

def from_ff(raw):
    out = []
    for e in raw:
        assets, imp, rule = ff_assets(e)
        if not assets: continue
        t = dt.datetime.fromisoformat(e['date'])
        nm = {'USD': 'US', 'CNY': 'China', 'EUR': 'Euro area'}.get(e['country'], e['country'])
        note = ' · '.join(x for x in [f"Forecast {e['forecast']}" if e.get('forecast') else '', f"previous {e['previous']}" if e.get('previous') else ''] if x)
        out.append(dict(id=f"ff-{e['country']}-{t.date()}-{e['title'].lower().replace(' ', '-')[:40]}", title=f"{nm} {e['title']}", when=iso(t), impact=imp,
                        assets=assets, note=(note + '. ' if note else '') + 'Source: ForexFactory feed', _rule=rule))
    return out

def mcx_close(d):
    # MCX evening session ends 23:30 IST while the US is on daylight time, 23:55 IST in US winter
    return ist(d.year, d.month, d.day, 23, 30) if et(d.year, d.month, d.day, 12, 0).dst() else ist(d.year, d.month, d.day, 23, 55)

SKIP = ('GOLDGUINEA', 'GOLDPETAL', 'MCXBULLDEX', 'MCXMETLDEX', 'MCXENRGDEX')
def expiries(contracts):
    by = {}
    for und, c in (contracts or {}).items():
        if und.startswith(SKIP): continue
        for x in [c] + ([c['next']] if c.get('next') else []):
            by.setdefault(x['expiry'], []).append((und, x['symbol']))
    out = []
    for day, xs in sorted(by.items()):
        d = dt.date.fromisoformat(day); und = sorted({u for u, _ in xs})
        out.append(dict(id=f'exp-{day}', title='MCX expiry: ' + ', '.join(und), when=iso(mcx_close(d)), impact='med', assets=und,
                        note='Contracts: ' + ', '.join(sorted(s for _, s in xs)) + '. The cockpit rolls to the next contract 3 days earlier (ROLL_DAYS=3).'))
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); ap.add_argument('--contracts-url'); ap.add_argument('--key-env', default='OPENALGO_VPS_API_KEY')
    ap.add_argument('--keep-days', type=int, default=21); a = ap.parse_args()
    now = dt.datetime.now(IST); notes = []
    try:
        raw = json.load(urllib.request.urlopen(urllib.request.Request(FF, headers={'User-Agent': 'cockpit-calendar/1.0'}), timeout=20)); ff = from_ff(raw)
    except Exception as e: ff = []; notes.append(f'feed unavailable: {e}')
    contracts = None
    try:
        if a.contracts_url:
            r = urllib.request.Request(a.contracts_url, headers={'X-API-KEY': os.environ.get(a.key_env, '')}); contracts = json.load(urllib.request.urlopen(r, timeout=20))['data']
        else:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import bridge; contracts = bridge.contracts()
    except Exception as e: notes.append(f'contracts unavailable: {e}')
    ev = {}
    prev = []
    if os.path.exists(a.out):
        try: prev = json.load(open(a.out)).get('events', [])
        except Exception: prev = []
    for e in prev: ev[e['id']] = e                       # keep history
    for e in [dict(id=i, title=t, when=iso(w), impact=im, assets=asx, note=n) for i, t, w, im, asx, n in FIXED]: ev[e['id']] = e
    ff_rule_days = {(e['_rule'], e['when'][:10]) for e in ff if e.get('_rule')}
    for e in weekly_rules(now.date()):
        if (e['_rule'], e['when'][:10]) in ff_rule_days: continue
        ev[e['id']] = e
    # if the feed has the week, drop rule-based entries for that week entirely (feed is authoritative, handles holiday shifts)
    if ff:
        wk0 = min(dt.datetime.fromisoformat(e['when']).date() for e in ff); wk1 = wk0 + dt.timedelta(days=7)
        for k in [k for k, e in ev.items() if e.get('_rule') and not k.startswith('ff-') and wk0 <= dt.datetime.fromisoformat(e['when']).date() < wk1]: ev.pop(k)
    for e in ff: ev[e['id']] = e
    for e in expiries(contracts): ev[e['id']] = e
    cut = now - dt.timedelta(days=a.keep_days); horizon = now + dt.timedelta(days=60)
    events = sorted([{k: v for k, v in e.items() if not k.startswith('_')} for e in ev.values()
                     if cut <= dt.datetime.fromisoformat(e['when']) <= horizon], key=lambda e: e['when'])
    out = dict(updated=now.isoformat(timespec='seconds'), tz='Asia/Kolkata',
               source='Auto-built on the VPS: ForexFactory weekly feed + official schedules (Fed, RBI, BLS, OPEC) + EIA/API weekly rules + MCX expiries from the OpenAlgo symbol master' + (' · ' + '; '.join(notes) if notes else ''),
               events=events)
    tmp = a.out + '.tmp'; json.dump(out, open(tmp, 'w'), indent=1, ensure_ascii=False); os.replace(tmp, a.out)
    print(f"wrote {len(events)} events ({sum(1 for e in events if e['when'] >= now.isoformat())} upcoming) → {a.out}" + (f" [{'; '.join(notes)}]" if notes else ''))
if __name__ == '__main__': main()
