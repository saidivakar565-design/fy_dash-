# fy_dash-

A personal Fyers market dashboard. It is data-only: the site holds no API keys. You enter your own Fyers App ID and Secret, and those credentials stay in your browser.

## Economic calendar and Spybot pins

`data/calendar.json` and `data/news_pins.json` are same-origin feeds for the phone cockpit (Calendar tab, the hub “Next up” strip, and markers on the full-screen chart). The page only reads them. It does not place orders.

The seed follows the 2 Nov 2026 macro clock (IST), including the one-hour later US prints after the 1 Nov clock change. See `data/README.md`.

The hub Signal matrix reads Bull / Bear / Flat from Fyers bars: higher high and higher low versus the prior window is Bull, lower high and lower low is Bear, otherwise Flat. Daily and 15m use 8 bars; 4H and 2H use 40. Cells stay blank until that login has candles.

## SHN Matrix v3.4

Trade state on the MCX hub (Flat tiles, Globe rings, chart panel), on the DC20 + SHN cards, and on the Screener tab is the validated v3.4 engine in `js/shn_v34.js` (the reference copy is `js/shn_matrix_v34_reference.js`). It reads closed bars only. MCX uses Fyers history for D, 4H, 2H and 15m, throttled under 40 requests a minute, and the laptop Market Radar address when Fyers is not logged in. The NSE screener reads `{laptop}/shn_v34_state.json` (schema in `data/shn_v34_schema.md`). When that file is unreachable it scans the on-phone watchlist, at most 30 NSE symbols, on Daily. No order endpoints are called.
