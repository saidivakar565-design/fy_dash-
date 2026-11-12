# `shn_v34_state.json`

The phone screener reads this file from the laptop Market Radar address (the same Tailscale HTTPS base already saved under **Laptop address**). The path is:

```
{laptop}/shn_v34_state.json
```

The page sends `X-Radar: 1` and does not send a Fyers token. CORS must allow `https://saidivakar565-design.github.io`. The phone never treats a missing file as prices: if the laptop is unreachable it scans the on-phone NSE watchlist (at most 30 symbols, Daily, closed bars) through Fyers.

MCX trade state in the cockpit is computed on the phone from Fyers history. This file is only the fallback when that login is missing, and it is the primary feed for the NSE tab.

## Top level

| Field | Required | Meaning |
|---|---|---|
| `version` | yes | `"3.4"` |
| `generated_at` | yes | ISO-8601 UTC time the scanner finished |
| `generated_ist` | yes | Same moment as `YYYY-MM-DD HH:MM` in Asia/Kolkata. Shown as the last scan time |
| `universe` | no | Label such as `nifty200` or `watchlist` |
| `timeframe` | no | Default timeframe for rows that omit `tf`. `D`, `4h`, `2h`, or `15m` |
| `symbols` | yes | Array of rows. `rows` is accepted as an alias |

## Each symbol

Computed by the same SHN Matrix v3.4 engine as `js/shn_v34.js` (V4a HA flip, body ≥ 0.3×ATR, ATR trail mult 2.0 that only tightens, wick-touch stop, UT Bot key 1.0 / ATR 10). Closed bars only. Do not write a row you did not compute.

| Field | Required | Meaning |
|---|---|---|
| `symbol` | yes | Root symbol, e.g. `SBIN`, `GOLDTEN` |
| `market` | yes | `NSE` or `MCX` |
| `fyers` | no | Full Fyers symbol, e.g. `NSE:SBIN-EQ` |
| `name` | no | Display name |
| `tf` | no | `D`, `4h`, `2h`, `15m`. Falls back to the file's `timeframe` |
| `state` | yes | Integer 1–7. See below |
| `state_label` | no | Engine label. The phone uses its own label from `state` when this is omitted |
| `action` | yes | Engine ACTION text, without the `ACTION:` prefix |
| `ltp` | no | Last close used for the state |
| `pos` | no | `1` long, `-1` short, `0` flat |
| `entry` | no | V4a entry, or null |
| `stop` | no | V4a trail, or null when flat |
| `stop_dist_pct` | no | `abs(ltp - stop) / ltp * 100` |
| `ut` | yes | `agree`, `weak`, or `flat` |
| `ut_pos` | no | `1`, `-1`, or `0` |
| `bars_since_flip` | no | Bars since the last V4a HA flip |
| `flip_time` | no | Unix seconds of that flip |
| `allow_short` | no | NSE cash should be `false`. MCX should be `true` |
| `forming` | no | `true` only for an intraday preview of a bar that has not closed. The phone shows it and will not alert on it |

### State codes

1. STRONG LONG
2. LONG · WEAKENING
3. STRONG SHORT
4. SHORT · WEAKENING
5. BULLISH · WAIT FOR BUY
6. BEARISH · WAIT FOR SELL when shorts are allowed, otherwise BEARISH · NO LONG
7. WAIT · MIXED

### Action text

- `HOLD · trail stop …`
- `HOLD · no adds · exit only if price < …` for a weakening long
- `HOLD · no adds · exit only if price > …` for a weakening short
- `WAIT · next BUY needs a V4a flip` or `WAIT · longs disabled`
- `WAIT · next SELL needs a V4a flip` or `STAND ASIDE · no long`
- `WAIT · mixed, no new trade`
- `EXIT HIT · …` on the bar of an exit

## Example

```json
{
  "version": "3.4",
  "generated_at": "2026-11-12T10:05:00Z",
  "generated_ist": "2026-11-12 15:35",
  "universe": "nifty200",
  "timeframe": "D",
  "symbols": [
    {
      "symbol": "SBIN",
      "market": "NSE",
      "fyers": "NSE:SBIN-EQ",
      "name": "State Bank of India",
      "tf": "D",
      "state": 1,
      "state_label": "STRONG LONG ▲",
      "action": "HOLD · trail stop 760.00",
      "ltp": 800.5,
      "pos": 1,
      "entry": 780.0,
      "stop": 760.0,
      "stop_dist_pct": 5.06,
      "ut": "agree",
      "ut_pos": 1,
      "bars_since_flip": 3,
      "flip_time": 1762684200,
      "allow_short": false,
      "forming": false
    }
  ]
}
```

The numbers above are a shape example for the scanner. The phone does not ship this object and will not display it unless a scanner actually serves the file.
