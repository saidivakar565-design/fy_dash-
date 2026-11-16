# fy_dash-

A personal Fyers market dashboard. It is data-only: the site holds no API keys. You enter your own Fyers App ID and Secret, and those credentials stay in your browser.

## Economic calendar and Spybot pins

`data/calendar.json` and `data/news_pins.json` are same-origin feeds for the phone cockpit (Calendar tab, the hub “Next up” strip, and markers on the full-screen chart). The page only reads them. It does not place orders.

The seed follows the 2 Nov 2026 macro clock (IST), including the one-hour later US prints after the 1 Nov clock change. See `data/README.md`.

The hub Signal matrix reads Bull / Bear / Flat from Fyers bars: higher high and higher low versus the prior window is Bull, lower high and lower low is Bear, otherwise Flat. Daily and 15m use 8 bars; 4H and 2H use 40. Cells stay blank until that login has candles.

## SHN Matrix v3.4

Trade state on the MCX hub (Flat tiles, Globe rings, chart panel), on the DC20 + SHN cards, and on the Screener tab is the validated v3.4 engine in `js/shn_v34.js` (the reference copy is `js/shn_matrix_v34_reference.js`). It reads closed bars only. MCX uses Fyers history for D, 4H, 2H and 15m, throttled under 40 requests a minute, and the laptop Market Radar address when Fyers is not logged in. The NSE screener reads `{laptop}/shn_v34_state.json` (schema in `data/shn_v34_schema.md`). When that file is unreachable it scans the on-phone watchlist, at most 50 NSE symbols, on Daily. Requests stay 1.6 seconds apart, under 40 a minute, so the first scan of a full list takes about a minute and a half to two minutes. The list paints each name as its closed daily bar arrives. No order endpoints are called.

## Cloud OpenAlgo (Hostinger VPS) — since 16 Nov 2026

The phone cockpit now runs entirely on the cloud OpenAlgo at `srv2165780.hstgr.cloud` (one daily Fyers login on the server feeds everything).

- **Live ticks:** `wss://srv2165780.hstgr.cloud/ws` (pre-filled). Paste the OpenAlgo API key once on the Live feed tab; it is kept only in this browser's localStorage and is **never** stored in this repo.
- **Candles / Daily board / SHN tiles / charts:** `js/vps_bridge.js` re-routes the page's Fyers `/data/history` calls to `https://srv2165780.hstgr.cloud/cockpit/fyhist` (same Fyers format, served from OpenAlgo `/api/v1/history`).
- **Fyers direct is switched off:** a Fyers API app allows one login at a time, so a phone login would log out the server.
- **PRO button** (`js/vps_pro.js`, read-only; open directly with `#pro`): SHN v3.4 server signals in both directions (Longs: v3.4 default, Shorts: Allow-shorts option; `/cockpit/shn`, refreshed 5 min after each 2H close on weekdays), live MCX watchlist, paper P&L marked to live ticks, R-multiple lot calculator, MCX session clock + expiry warnings. Prices tick live over its own read-only WebSocket subscription; a green dot means a tick in the last 5 s. On a laptop (>= 1100 px wide) all panels show side by side.
- Server side: nginx allows CORS from `https://saidivakar565-design.github.io` only, and only for read endpoints (quotes, multiquotes, history, positionbook, funds, ping, depth, intervals, analyzer, orderbook, tradebook). No order endpoint is reachable from this page.
- Previous version: branch `backup-pre-cloud-openalgo-20261116`.
