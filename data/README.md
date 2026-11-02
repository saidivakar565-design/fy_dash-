# Calendar and Spybot pins

Same-origin JSON for the phone cockpit. On GitHub Pages the live URLs are:

- `…/fy_dash-/data/calendar.json` — scheduled economic / commodity events
- `…/fy_dash-/data/news_pins.json` — Spybot material headlines only

The page fetches these files. It does not poll a news API and it does not place orders. A pin is written only when something material hits commodities or Indian equities.

## Dates

The current seed is the **2 Nov 2026, 08:40 IST** macro clock: MCX open 09:00, ISM Manufacturing 20:30, US midterms ~05:30 on 3 Nov, JOLTS 20:30, ISM Services 20:30 on 4 Nov, NFP 19:00 and Michigan sentiment 20:30 on 6 Nov. US clocks went back on Sun 1 Nov, so those US prints are **1 hour later in IST** than the week before.

Times are Asia/Kolkata (`+05:30`). Replace this file when the next board is published — do not keep a stale week on the phone.

## Schema

Calendar event: `id`, `title`, `when` (ISO 8601 with `+05:30`), `impact` (`high` | `med` | `low`), `assets[]`, `note`.

Pin: `id`, `when`, `headline`, `bias`, `assets[]`, `severity` (`high` | `med` | `low`), `url` optional.

Asset tags are families. `CRUDEOIL` matches MCX crude and crude mini (`CRUDEOIL` / `CRUDEOILM`, including the cockpit’s WTI crude card). The same idea applies to the GOLD, SILVER, NATURALGAS, ZINC, ALUMINIUM, and NIFTY families.

On a chart, a past headline pin is a solid numbered flag and an upcoming release is a hollow flag. The same numbers are listed under the chart.
