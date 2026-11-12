# NSE sector map

`data/nse_sectors.json` is the list the Screener uses for NSE sector rotation. The phone does not download index membership.

## Fyers symbols

Each `sectors[].fyers` value was checked against the Fyers index dictionary shipped in this app (`index.html`, the SDK symbol map). These are the names that dictionary actually contains:

| Sector | Fyers symbol |
|---|---|
| Nifty 50 (benchmark) | `NSE:NIFTY50-INDEX` |
| Nifty Bank | `NSE:NIFTYBANK-INDEX` |
| Nifty Pvt Bank | `NSE:NIFTYPVTBANK-INDEX` |
| Nifty PSU Bank | `NSE:NIFTYPSUBANK-INDEX` |
| Nifty Fin Service | `NSE:FINNIFTY-INDEX` |
| Nifty IT | `NSE:NIFTYIT-INDEX` |
| Nifty Auto | `NSE:NIFTYAUTO-INDEX` |
| Nifty Pharma | `NSE:NIFTYPHARMA-INDEX` |
| Nifty Healthcare | `NSE:NIFTYHEALTHCARE-INDEX` |
| Nifty FMCG | `NSE:NIFTYFMCG-INDEX` |
| Nifty Metal | `NSE:NIFTYMETAL-INDEX` |
| Nifty Energy | `NSE:NIFTYENERGY-INDEX` |
| Nifty Oil & Gas | `NSE:NIFTYOILANDGAS-INDEX` |
| Nifty Realty | `NSE:NIFTYREALTY-INDEX` |
| Nifty Infra | `NSE:NIFTYINFRA-INDEX` |
| Nifty Consumer Durables | `NSE:NIFTYCONSRDURBL-INDEX` |
| Nifty Media | `NSE:NIFTYMEDIA-INDEX` |

`NSE:FINNIFTY-INDEX` is the dictionary entry labelled "Nifty Fin Service". There is no `NSE:NIFTYFINSERVICE-INDEX` in that map. Do not add an index that is not in the dictionary. History requests use the string as written.

## How to update membership

1. Take the latest NSE factsheet for that sector index.
2. Replace that sector's `stocks` array with NSE equity tickers (`HDFCBANK`, not `NSE:HDFCBANK-EQ`).
3. Set `chips[SYMBOL]` to the industry name the screener chips already use when the symbol is not in the built-in Nifty 50 series: Financial Services, Information Technology, Healthcare, Automobile and Auto Components, Fast Moving Consumer Goods, Metals & Mining, Oil Gas & Consumable Fuels, Power, Construction, Construction Materials, Capital Goods, Consumer Durables, Consumer Services, Services, Telecommunication. Realty and Media are extra chip labels because those industries are not in the Nifty 50 series baked into the page.
4. A symbol may sit in more than one index. SBIN is in Nifty Bank and Nifty PSU Bank. Relative strength versus the sector uses the index you tapped.
5. This file is a maintained subset of Nifty 200 names, grouped by the index you drill into. It is not a live membership feed. A name that leaves an index stays here until you edit it. The phone never invents a member, and a symbol with no candles stays blank.

## What the phone computes

Closed daily bars only, from Fyers history, cached on the phone so the next open does not refetch them the same day. Weekly points are the last closed day of each IST week. The formula is in `js/shn_rotation.js` and matches the Rotation tab: RS-Ratio = 100 × EMA10(RS) / EMA26(RS), RS-Momentum = 100 × RS-Ratio / EMA6(RS-Ratio). A laptop scan may also send a `rotation` block. See `data/shn_v34_schema.md`. Candles on the phone replace that block for any sector they cover.
