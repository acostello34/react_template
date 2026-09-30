# Handoff — 2026-09-28

Session context for `/Users/acost/Documents/react_temp`. Passes 1–3 were built
on 2026-09-25 into an empty directory; pass 4 (the dashboard layer) on
2026-09-28.

Read `README.md` for how to *use* the code. This file is about *why* it looks
the way it does, what is proven, and what isn't.

## What this is

A React + FastAPI slice built in four passes:

1. A reusable `useApi` hook (axios + AntD) and a standard Pydantic response
   envelope.
2. A generic `<DataTable>` driven by a column definition, with a multi-column
   filter bar, and the Pandas-backed endpoint it talks to.
3. A `<DataChart>` Recharts wrapper that maps keys off that endpoint's JSON.
4. A `Dashboard` layer: `useFilteredDataset` + a borderless KPI grid + Tufte
   line/bar wrappers + a Row/Col shell, assembled in `TufteDashboard.tsx`.

Each pass builds on the last: the table's filter bar emits query params the
endpoint reads by name, and the chart consumes the same payload the table does.

## Stack

| | |
|---|---|
| Frontend | React 18.3, TypeScript 5.6 (strict), antd 5.29, axios 1.x, recharts 2.15, dayjs |
| Backend | FastAPI, Pydantic v2, Pandas, Python 3.11+ (uses `typing.Self`) |
| Build | Vite 8 dev server + `tsc --noEmit`. **No test runner.** |

`npx tsc --noEmit` is the only frontend check wired up. `npm run typecheck` runs it.

## Layout

```
src/api/                 useApi's plumbing: client, error normalization, loading store, AntD bridge
src/hooks/useApi.ts      the hook
src/components/DataTable/  column defs -> filter bar + Table (client or server mode)
src/components/Chart/      payload -> inferred keys -> aggregated -> Recharts in an AntD Card
src/components/Dashboard/  one filtered array -> KPI tiles, Tufte charts, table
src/examples/            five worked examples; not wired to a router
backend/app/schemas/     APIResponse[T] envelope
backend/app/core/        exception handlers, request-id/timing middleware
backend/app/data/        mock product DataFrame (240 deterministic rows)
backend/app/api/         the filtered products endpoint
```

## The contract between the halves

This is the part to preserve if you change either side.

- **Envelope.** `{status, message, data, errors, metadata}`. `src/api/types.ts`
  is a hand transcription of `backend/app/schemas/response.py` — change one,
  change the other.
- **Filter params.** A column key `k` emits `k` (text/select/boolean),
  `k_min`/`k_max` (number range), `k_from`/`k_to` (date range), plus `q`,
  `page`, `page_size`, `sort_by`, `sort_order`. `buildQueryParams` in
  `src/components/DataTable/filters.ts` produces them; `list_products` in
  `backend/app/api/products.py` declares them one-for-one. No translation layer
  exists, deliberately — the names *are* the interface.
- **Array params** are repeated (`category=Gin&category=Rum`), which is why the
  axios instance sets `paramsSerializer: { indexes: null }`. Without it axios
  sends `category[]=` and FastAPI sees nothing.

## Decisions worth knowing

- **User-facing toasts live in the hook, not the interceptor.** The interceptor
  normalizes errors and handles session concerns (`onUnauthorized`, `onError`
  for telemetry); the hook decides what the user sees. Splitting it this way
  means a request can never produce two toasts.
- **Client and server filtering share semantics.** `applyClientFilters` mirrors
  the endpoint (case-insensitive substring, `in` for multi-select, inclusive
  bounds), so `mode="client"` and `mode="server"` look the same to a user.
- **Charts encode dataviz rules rather than trusting call sites**: color follows
  the entity (filtering never repaints survivors), hues are never generated past
  eight validated slots, no dual axis, every chart has a table view. The palette
  was validated with the dataviz skill's `validate_palette.js` against AntD's
  own surfaces — if you swap in brand hues, re-run it, don't eyeball.
- **Charts state their own coverage.** Given a page of a larger result set, the
  card says "Showing 200 of 240 rows" rather than implying it drew everything.
- **The dashboard owns the filtering, not the table.** `<DataTable mode="client">`
  filters internally, which makes the filtered rows unreachable — a KPI tile or
  chart would have to re-derive them and could disagree with the table.
  `useFilteredDataset` holds the state one level up, runs `applyClientFilters`
  once, and passes the result by reference; the table renders with the new
  `mode="external"` and re-filters nothing. Three views, one array, no drift.
- **The Tufte charts spend one hue only while there is one series.** A varying
  hue is ink doing a labelling job; on a single measure there is nothing to
  label. Two or more series fall back to the validated categorical palette and
  a legend — identity never rests on one color. The muted steps (`#3d6ea8` /
  `#5a8fcc`) passed the same validator as the categorical eight.

## Verification status

Proven:

- Backend exercised with `TestClient`: envelope on success and on every failure
  path, filters (single, multi, ranges, boolean, date window, combined),
  sorting allowlist rejection, out-of-range page, regex-looking `q`, empty
  results, and `/openapi.json` building with generics resolved.
- `filters.ts` compiled and asserted: param building, blank-value omission,
  nested `dataIndex`, inclusive bounds, same-day ranges — under `TZ=Asia/Tokyo`
  and `TZ=America/Los_Angeles` as well as locally.
- `prepare.ts`/`fields.ts` checked against **pandas ground truth** on the real
  240-row payload: sums, means, counts, a two-key pivot, month bucketing, fold
  preserving totals, key-type inference.
- Chart components rendered in jsdom and their SVG inspected: mark counts,
  rounded data-ends, 2px gaps between stacked segments, gridline style, legend
  presence rules, empty state, and colour stability across a filter change.
- The dashboard layer rendered in jsdom (2026-09-28) and its SVG/DOM inspected:
  - single-series bar and line carry the muted hue only (`#3d6ea8`), line
    `fill="none"`, 2px stroke; multi-series (`splitBy`) switches to three
    categorical hues plus a three-item legend;
  - no axis lines, no tick lines, no vertical gridlines anywhere; `tickCount`
    honoured (4 y ticks, not Recharts' default);
  - `directLabels` emits one label per bar and drops the y axis; on a line it
    emits exactly one end-of-series label;
  - `mode="external"` renders no filter bar (0 filter inputs, no Search/Reset).
- End-to-end agreement, against values recomputed independently in the test:
  unfiltered 60 rows -> tiles 60 / 257,404 / 98.5 / 7, four category bars, 60
  table rows; with `category in (Gin,Rum) AND status=active` -> 10 rows, tiles
  10 / 36,200 / 100 / 3, two bars, 10 table rows. Tiles, chart and table moved
  together in one commit.
- `tsc --noEmit` clean under `strict`.

**Not** proven:

- **Still nothing has been looked at in a real browser.** As of 2026-09-28 the
  app boots (`vite` on :5173, `uvicorn` on :8000), serves, and builds clean —
  `tsc --noEmit` plus a 2054-module production bundle — and the proxied
  endpoint returns the right rows through `/api/v1`, including repeated array
  params. But no one has seen a rendered pixel: tick density, label collision
  and anything depending on real text measurement remain unverified.
- No automated test suite exists in the repo. The checks above ran from
  throwaway scripts in a session scratchpad that is now gone; redoing them
  means rewriting the harness.
- The React components have never been mounted in an actual app.

## Known gaps / obvious next steps

1. **Port the throwaway checks into a real test suite** (Vitest for
   `filters.ts`/`prepare.ts`/`fields.ts`, pytest for the endpoint). The
   assertions are described above; they were worth having.
2. `backend/app/data/products.py` is mock data behind `lru_cache`. Swapping it
   for a real query changes nothing above it — that boundary is the point.
3. ~~The examples aren't routed.~~ Done — `src/App.tsx` switches between all
   four. Note `UsersExample` exports `Root`, not `UsersExample`, and brings its
   own `ConfigProvider`/`<App>`, so the shell's dark toggle does not reach it.
4. Per-request auth token comes from `localStorage` in the examples only;
   `configureApi({ getAuthToken })` is where a real implementation plugs in.

## Gotchas

- **Don't set `immediate: true` on a `useApi` feeding a server-mode
  `<DataTable>`** — `onQueryChange` already fires on mount, so the first load
  runs twice.
- **`_records()` in `products.py` casts to `object` before `to_dict`.** Without
  it Pandas hands back numpy scalars (`np.int64`, `np.bool_`) that Pydantic
  rejects. Don't "simplify" it away.
- **`str.contains(..., regex=False)` everywhere** in the endpoint: the value is
  user input, not a pattern.
- **Dates: parse with dayjs, not `new Date`.** A bare `YYYY-MM-DD` is UTC
  midnight to the `Date` constructor but local midnight to AntD's picker; that
  mismatch silently dropped same-day matches outside UTC. Fixed in
  `filters.ts`; the same trap applies anywhere else dates get compared.
- **Rendering recharts in jsdom needs three stubs, and one of them is a trap.**
  `ResizeObserver` (or `ResponsiveContainer` measures 0 and draws nothing) and
  a `getBoundingClientRect` that sizes the `#recharts_measurement_span` from
  its text (or every tick label measures the full chart width, the axis decides
  they all collide, and you get one tick). The trap is `offsetHeight`: recharts'
  `Legend.getBBox` *overwrites* the measured height with `wrapperNode.offsetHeight`,
  so a blanket `offsetHeight = chartHeight` makes the legend exactly as tall as
  the plot, the plot height goes to zero, and the chart silently renders no
  grid, no scale and no marks. It looks exactly like a data bug and is not one —
  it reproduces with a bare `<BarChart>` and a default `<Legend>`. Keep
  `offsetHeight` legend-sized (~20).

- **AntD version.** The session briefly moved to antd 4 on request, then back to
  5 when you confirmed 5 was fine. Everything now assumes 5 — `App.useApp()`
  and dayjs. If it ever moves to 4, `src/api/notifier.tsx` needs
  `message.useMessage()`/`notification.useNotification()` instead of `App`, and
  the date filter needs moment.
- **`/Users/acost/Documents/CLAUDE.md` belongs to an unrelated project** (a
  computer-vision interview use case). It loads as project context from the
  parent directory but has nothing to do with this repo.
