# `useApi` + standard response envelope

A React data-fetching layer (axios + AntD) and the FastAPI response envelope it
expects. The two halves share one contract: `src/api/types.ts` is a direct
transcription of `backend/app/schemas/response.py`.

```
src/
  api/
    types.ts          ApiResponse<T>, ApiMetadata, ApiError  (mirrors the backend)
    client.ts         axios instance, interceptors, error normalization
    loadingStore.ts   global in-flight counter + useGlobalLoading()
    notifier.tsx      bridge to AntD's context-aware message/notification
    index.ts          public surface
  hooks/
    useApi.ts         the hook
  components/Chart/
    palette.ts        validated series palette + AntD-token chart theme
    fields.ts         infers key types from the payload
    prepare.ts        group / aggregate / pivot / fold -> chart rows
    format.ts         compact and full number formatting
    ChartChrome.tsx   tooltip + legend
    DataChart.tsx     the component (Recharts + AntD Card)
  components/DataTable/
    types.ts          DataTableColumn<T> + the filter specs
    filters.ts        column defs + control state -> query params / predicate
    FilterBar.tsx     the top action bar (presentational)
    DataTable.tsx     the component: bar + Table, client or server mode
  components/Dashboard/
    useFilteredDataset.ts  one filtered array for the whole page
    metrics.ts        metric specs + evaluation (pure)
    MetricGrid.tsx    the borderless KPI row
    theme.ts          the muted single-series hue
    TufteChart.tsx    TufteLineChart / TufteBarChart
    DashboardLayout.tsx    filters -> KPIs -> charts -> table
  App.tsx             app shell: providers, example switcher, dark toggle
  main.tsx            createRoot entry
  examples/
    UsersExample.tsx  wiring, a query, a mutation, form-field errors
    ProductsTable.tsx DataTable + useApi against the products endpoint
    ProductsDashboard.tsx  filter row + stat tiles + four charts
    TufteDashboard.tsx     one filtered array -> KPIs + charts + table
backend/app/
  schemas/response.py   APIResponse[T], ErrorDetail, PaginationMeta
  core/errors.py        domain exceptions + handlers that emit the envelope
  core/middleware.py    request id + timing
  data/products.py      mock product DataFrame + filter options
  api/products.py       filtered listing endpoint (Pandas)
  main.py               example routes
```

## Running it

Two processes. Backend first:

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
npm run dev:api      # uvicorn on :8000
```

Then the frontend, in a second terminal:

```bash
npm install
npm run dev          # vite on :5173
```

Open <http://localhost:5173>. The header switches between the four examples and
toggles dark mode.

Vite proxies `/api` to `http://localhost:8000`, so the browser makes a
same-origin request and CORS never applies in development. The port is
`strictPort`, because the backend's CORS allow-list names 5173 explicitly and a
silent slide to 5174 would look like a bug in the fetch layer. `configureApi`
in `src/App.tsx` sets the base URL to `/api/v1` — the client's own default is
`/api`, which would miss the `/v1` the routers are mounted under. Override with
`VITE_API_BASE_URL` to point at a deployed backend instead.

`npm run build` runs `tsc --noEmit` and then a production bundle.


## Frontend

### 1. Wire it up once

```tsx
configureApi({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  getAuthToken: () => localStorage.getItem('access_token'),
  onUnauthorized: () => window.location.assign('/login'),
});

<ConfigProvider theme={theme}>
  <App>
    <ApiFeedbackBridge>{/* your routes */}</ApiFeedbackBridge>
  </App>
</ConfigProvider>
```

`ApiFeedbackBridge` must sit inside AntD's `<App>`. It captures the
`message`/`notification` instances from `App.useApp()` and hands them to the api
layer, so toasts inherit your theme and locale instead of triggering AntD v5's
"static function can not consume context" warning. It falls back to the static
instances if it hasn't mounted yet.

### 2. Use the hook

```tsx
// Query: fires on mount, refetches when `status` changes.
const orders = useApi(({ signal }, status: string) =>
  api.get<Order[]>('/orders', { params: { status }, signal }), {
  immediate: true,
  defaultArgs: [status],
  initialData: [],
  deps: [status],
});

// Mutation: fired by hand.
const approve = useApi(({ signal }, id: string) =>
  api.post<Order>(`/orders/${id}/approve`, undefined, { signal }), {
  channel: 'notification',
  successMessage: (order) => `Order ${order.id} approved.`,
  onSuccess: () => void orders.run(status),
});

<Table dataSource={orders.data} loading={orders.loading} />
<Button loading={approve.loading} onClick={() => approve.run(id)}>Approve</Button>
```

The context object comes **first** so TypeScript can infer your own arguments
whatever their number. Thread `signal` into the axios call and cancellation
works end to end.

### What it handles

| Concern | Behavior |
| --- | --- |
| Global loading | Every request bumps a counter; `useGlobalLoading()` reads it anywhere. Opt a call out with `{ globalLoading: false }` in the axios config. |
| Per-hook loading | `loading` covers only that hook's request. |
| Superseded calls | A new `run()` aborts the previous one; the abandoned response never lands in state. |
| Unmount | In-flight request is aborted (`cancelOnUnmount: false` to opt out), and late responses are dropped instead of setting state. |
| Errors | Everything — axios errors, `{status: "error"}` envelopes, FastAPI `detail` strings, 422 arrays, network drops, timeouts — becomes an `ApiError` with `code`, `httpStatus`, `details`, `requestId`, `fieldErrors`. |
| Feedback | `errorMessage`/`successMessage` (string or function; return `null` to stay silent), routed to `message` or `notification` via `channel`. `showError: false` when you render errors inline. |
| Auth | A 401 fires `onUnauthorized` once, centrally. |
| Non-enveloped endpoints | Bare JSON payloads are wrapped client-side, so third-party APIs work with the same hook. |

`run()` resolves to `data | undefined` and never throws (the error is already
reported). `runAsync()` rejects with `ApiError` when you want `try/catch`.

### Notes

- `data` and `metadata` are split out of the envelope, so pagination is
  `result.metadata?.pagination` while `result.data` is just your rows.
- `deps` follows the usual deps-array rule: keep its length stable.
- Concurrency and caching are deliberately out of scope — if you need request
  deduplication, background refetch or a normalized cache, this layer composes
  under TanStack Query rather than competing with it.

## `<DataTable />`

One generic component driven by one column definition. A column that carries a
`filter` spec automatically gets a control in the top action bar, a query
param, and (in client mode) an in-memory predicate — nothing is declared twice.

```tsx
const columns: DataTableColumn<Product>[] = [
  { key: 'name', title: 'Product', searchable: true, sorter: true,
    filter: { kind: 'text', placeholder: 'Name contains…' } },
  { key: 'category', title: 'Category',
    filter: { kind: 'select', multiple: true, options: categories } },
  { key: 'price', title: 'Price', align: 'right', sorter: true,
    render: (value: number) => `$${value.toFixed(2)}`,
    filter: { kind: 'numberRange', step: 5, precision: 2 } },
  { key: 'in_stock', title: 'Available', filter: { kind: 'boolean' } },
  { key: 'created_at', title: 'Added', filter: { kind: 'dateRange' } },
];

<DataTable<Product>
  mode="server"
  rowKey="id"
  columns={columns}
  data={products.data ?? []}
  total={products.metadata?.pagination?.total_items}
  loading={products.loading}
  onQueryChange={(params) => void products.run(params)}
  actions={<Button type="primary">New product</Button>}
/>
```

`DataTableColumn<T>` extends AntD's `ColumnType<T>`, so `render`, `sorter`,
`width`, `align` and the rest work as usual. Extra keys: `filter`, `searchable`
(feeds the single search box), `hidden`, and a `key` that defaults `dataIndex`,
the param names and the sort field.

### Filter kinds and the params they emit

| Kind | Control | Params emitted (for column key `k`) |
| --- | --- | --- |
| `text` | Input | `k` |
| `select` | Select, `multiple` for many | `k`, repeated per value when multiple |
| `numberRange` | paired InputNumbers | `k_min`, `k_max` |
| `dateRange` | RangePicker | `k_from`, `k_to` (YYYY-MM-DD) |
| `boolean` | Yes/No Select | `k` (true/false) |

Plus `q` (spans every `searchable` column), `page`, `page_size`, `sort_by`,
`sort_order`. Override any name on the filter spec (`param`, `minParam`, …).
Blank controls are omitted entirely rather than sent empty.

### Two modes

- **client** — `applyClientFilters` narrows `data` in the browser; AntD sorts
  and paginates. Good for a few hundred rows already in hand.
- **server** — `data` is rendered as-is and `onQueryChange(params, state)`
  fires on mount and on every search, reset, page or sort change. `params` goes
  straight into `api.get(url, { params })`.
- **external** — something above the table already filtered these rows (see
  `useFilteredDataset` below). The table renders no filter bar and re-filters
  nothing; it still sorts and paginates locally.

Both modes share the same semantics (case-insensitive substring, `in` for
multi-select, inclusive range bounds), so switching one for the other doesn't
change what a user sees.

Two things worth knowing:

- The bar holds a **draft** separate from the **applied** filters — typing
  doesn't fire requests; Search, Enter, or Reset does. Beyond
  `collapsedFilterCount` (default 3), the extra controls fold behind a "More
  filters" toggle that reports how many of the hidden ones are set.
- In server mode `onQueryChange` already fires on mount, so the `useApi` hook
  behind it must **not** be `immediate` — otherwise the first load runs twice.

`filters.ts` is plain functions (`buildQueryParams`, `applyClientFilters`,
`toFilterFields`), and `FilterBar` holds no filter state, so either can be used
on its own — a bar above a chart, or params built for a CSV export link.


## `<DataChart />`

A Recharts wrapper that takes the products endpoint's payload as-is and maps
its keys. It accepts the envelope or a bare array, reads the keys back off the
data, groups and aggregates, and renders into an AntD `Card`.

```tsx
<DataChart<Product>
  title="Stock on hand by category"
  data={products.data}          // ApiResponse<Product[]> or Product[]
  loading={products.loading}
  kind="bar"                    // bar | stackedBar | line | area | pie
  x="category"                  // any key in the payload
  y="stock"                     // any numeric key (or an array of them)
  aggregate="sum"               // sum | mean | count | min | max
/>

// Split one measure into a series per value of another key:
<DataChart data={products.data} kind="stackedBar" x="category"
           aggregate="count" splitBy="status" colorDomain={STATUS_DOMAIN} />

// Dates bucket; everything can be inferred:
<DataChart data={products.data} x="created_at" bucket="month" aggregate="count" />
<DataChart data={products.data} />   // keys, measure and form all inferred
```

### How the keys are mapped

`inferFields` samples the rows and types every key (`number`, `category`,
`date`, `boolean`), which is what lets the component work against a DataFrame
whose columns aren't known at build time. With no `x`/`y` given, it prefers a
date field for x (a trend is the usual reading), else the lowest-cardinality
categorical, and the first numeric field for y — skipping identifier-ish keys
(`id`, `sku`, `code`…) that would produce 240 bars.

`prepareChartData` then does the DataFrame work in the browser: group by x
(bucketing dates to day/week/month/year), aggregate, pivot `splitBy` into one
column per series, fold the tail, and order. It's pure — no React — so it is
tested directly against pandas.

### What it enforces

The component encodes a set of chart rules so call sites can't quietly break
them:

- **One color per entity, never per rank.** Slots are assigned by series *name*
  and remembered, so filtering a series away never repaints the survivors.
  `colorDomain` fixes the assignment up front.
- **Colors are never generated.** Eight validated slots; series past
  `maxSeries` (default 6) fold into a gray "Other", and categories past
  `maxCategories` (12) do the same — the chart says so under its title.
- **One series gets one color and no legend** (the title names it); two or more
  always get a legend. A pie's identities are its slices, so it legends those.
- **No dual axis, ever.** Several `y` keys share one scale; two measures of
  different magnitude are two charts.
- **Marks:** bars capped at 24px with a 4px rounded data-end and square
  baseline, 2px lines, dots with a 2px surface ring, area fills at 10%, and a
  2px surface *gap* between stacked segments (a custom shape, not a stroke —
  no non-data ink). Gridlines are solid hairlines, horizontal only.
- **Every chart has a table view.** The Segmented toggle in the card header
  swaps the plot for the same numbers in an AntD Table. That is also what
  discharges the light-mode contrast relief the palette requires.
- **Refetch holds the frame.** While `loading` is true with data already on
  screen, the chart dims to 55% instead of flashing a skeleton.
- **Partial pages are declared.** If `metadata.pagination.total_items` exceeds
  the rows it was given, the card says "Showing 200 of 240 rows (current
  page)" rather than implying it drew everything.

### Theming

`useChartTheme()` reads chrome (surface, ink, grid, axis, radius, shadow) from
AntD's `theme.useToken()`, so charts follow `ConfigProvider` — including dark
mode, which is detected from the rendered surface's luminance rather than
passed in. Only the series hues come from the fixed palette.

That palette is the dataviz skill's validated eight, re-checked against AntD's
own surfaces (`#ffffff` / `#141414`) rather than the skill's defaults: lightness
band, chroma floor, adjacent CVD separation (worst ΔE 9.1 light / 8.4 dark
against a ≥8 target) and normal-vision separation (19.6 / 19.3 against a ≥15
floor) all pass. Three light-mode hues sit below 3:1 contrast, which is why the
table view is not optional. Swapping in brand hues means re-running
`validate_palette.js`, not eyeballing.


## Dashboard layer

`src/components/Dashboard/` composes the pieces above into a page: a KPI row,
Tufte-styled charts, and the table, all reading **one** filtered array.

```tsx
const dataset = useFilteredDataset(products, COLUMNS);
const { rows } = dataset;

<DashboardLayout
  title="Catalogue"
  filters={<FilterBar
    fields={dataset.filterFields}
    values={dataset.draft}
    onChange={dataset.setDraft}
    onSearch={dataset.search}
    onReset={dataset.reset}
  />}
  metrics={<MetricGrid data={rows} metrics={METRICS} />}
  charts={[
    <TufteBarChart key="a" data={rows} x="category" y="stock" aggregate="sum" />,
    <TufteLineChart key="b" data={rows} x="created_at" aggregate="count" bucket="month" />,
  ]}
  table={<DataTable columns={COLUMNS} data={rows} rowKey="id" mode="external" />}
/>
```

`src/examples/TufteDashboard.tsx` is the worked version.

### One array, not three

`<DataTable mode="client">` filters internally, which is right for a screen
that is only a table — but it makes the filtered rows unreachable, so a tile or
a chart would have to re-derive them and would be free to disagree with the
table.

`useFilteredDataset` moves the state up one level: it holds draft/applied
filters, runs `applyClientFilters` once, and hands the result to every
consumer by reference. The table then renders `mode="external"`. The tiles, the
charts and the table cannot drift, because there is no second copy to drift
from. `live: true` filters as the user types instead of on Search — safe here,
since the work is a synchronous array pass rather than a request.

It also returns `params`, the applied filters as query params. Nothing uses it
while filtering is local; it is what you hand axios the day the dataset
outgrows the browser, and the reason that migration touches one file.

### `<MetricGrid />`

Four tiles from the filtered array. A spec is `{ label, aggregate, field }`,
where `aggregate` is `count | sum | mean | median | min | max | distinct`, plus
optionally `value` (a derived measure — `row => row.price * row.stock`),
`where` (narrow the rows first), `format` and `caption`. Omit `metrics`
entirely and it derives a row from the data's own shape: count, then the sum
and mean of the first real measure, skipping keys that merely identify a row.

Deliberately not `<Card><Statistic/></Card>`. A card draws a border, a radius,
a shadow and ~40px of padding around four numbers — non-data ink whose only
message is "these are grouped", which the grid already says. Whitespace
separates them instead, and the hierarchy is type alone. Figures are
`tabular-nums` so digits line up between tiles.

Non-numeric and missing cells are skipped rather than read as zero: a mean over
200 rows where 40 are blank is a mean of 160.

### `<TufteLineChart />` / `<TufteBarChart />`

Same props as `<DataChart>` for data (`x`, `y`, `aggregate`, `splitBy`,
`bucket`, `sort`) — and the same `prepareChartData` behind them, so these and
`<DataChart>` cannot disagree about what "mean of price by category" means.

Removed, each because it was ink carrying nothing: axis lines, vertical
gridlines, tick marks, half the y ticks, area fills under lines, bar outlines,
and mount animation. Kept: hairline horizontal gridlines (a bar's height is
genuinely read against them, and `grid={false}` drops them too), the hover
layer, and the table view.

`directLabels` labels the data instead of the axis — the last point on a line
(the default there), or every bar, in which case the y axis is dropped as
redundant.

**One muted hue, until there are two series.** A varying hue is ink doing a
*labelling* job, and on a single measure there is nothing to label. So one
series gets `#3d6ea8` (light) / `#5a8fcc` (dark) — both run through the dataviz
validator against AntD's surfaces and passing the lightness band, chroma floor
and 3:1 contrast. "Muted" there is low chroma, not low contrast: any further
down and the validator fails them for reading as gray. Two or more series
abandon that hue for the validated categorical palette plus a legend, because
identity must never rest on a single color.


## Backend

```python
@app.get("/users", response_model=APIResponse[list[UserOut]])
async def list_users(request: Request, page: int = 1) -> APIResponse[list[UserOut]]:
    rows, total = await repo.list(page)
    return APIResponse[list[UserOut]].paginated(
        rows, page=page, page_size=20, total_items=total,
        metadata=build_metadata(request),
    )
```

Constructors — `ok`, `paginated`, `fail` — exist so `status`, `data` and
`errors` can't disagree with each other. Failures are raised, not returned:

```python
raise NotFoundError(f"No user with id {user_id!r}.")
raise ConflictError("That email is already registered.", code="email_taken")
```

`register_exception_handlers(app)` catches `AppError`, `HTTPException`,
`RequestValidationError` and anything unhandled, and renders each as the same
envelope. Validation errors keep their field paths (with FastAPI's leading
`body`/`query` segment stripped), which is what makes `error.fieldErrors` line
up with AntD form names on the client. Unhandled exceptions log in full and
return a generic message.

`metadata` allows extra keys (`ConfigDict(extra="allow")`), so a handler can
attach one-offs — `APIResponse.ok(data, cache="hit")` — without a schema
change. `RequestContextMiddleware` fills in `request_id` and `duration_ms` and
echoes `X-Request-ID`; CORS must list that header under `expose_headers` or the
browser hides it.

### Filtered listing with Pandas

`GET /api/v1/products` takes every filter as an optional query parameter, with
names matching what `buildQueryParams` emits, and narrows a cached DataFrame:

```python
mask = pd.Series(True, index=frame.index)
if name:
    mask &= frame["name"].str.contains(name, case=False, na=False, regex=False)
if category:
    mask &= frame["category"].isin(category)
if price_min is not None:
    mask &= frame["price"] >= price_min
filtered = frame.loc[mask]
```

One mask narrowed per supplied parameter, then `.loc` — which returns a copy,
so the cached frame is never mutated. Details worth keeping if you adapt this:

- `regex=False` on every `str.contains`: the value is user input, not a
  pattern. A stray `(` would otherwise 500, and a crafted one is a ReDoS.
- `sort_by` is checked against a `SORTABLE_COLUMNS` allowlist, so it can't
  reach arbitrary attributes; anything else is a 400 in the standard envelope.
- The `_to` end of a date window is compared as `< to + 1 day`, so a single-day
  window matches rows whatever time component they carry.
- `.astype(object)` before `to_dict`: `to_dict` otherwise yields numpy scalars
  (`np.int64`, `np.bool_`) that Pydantic rejects.
- `GET /api/v1/products/filters` returns the select options from the data
  itself, so a new category needs no frontend deploy.

Swap `app/data/products.py` for a real query and nothing above it changes.

Requires Python 3.11+ (uses `typing.Self`), FastAPI, Pydantic v2.

## Verified

- Backend: exercised with `TestClient`. Users routes — create / duplicate /
  validation-error / paginated list / 404 — all return the envelope, and
  `/openapi.json` builds with the generics resolved. Products endpoint checked
  across single and multi-value filters, price and date windows, the boolean
  filter, combined filters with sort and paging, an empty result, a rejected
  `sort_by`, an out-of-range `page`, and a regex-looking `q`.
- Charts: `prepare.ts` and `fields.ts` were compiled and checked against
  pandas ground truth on the real 240-row payload — sum, mean and count
  aggregations, a two-key pivot, month bucketing, tail folding (totals
  preserved) and key-type inference all match. The components were then
  rendered in jsdom and their SVG inspected: mark counts, one-color single
  series, 4px rounded data-ends on bars, exactly 2px gaps between stacked
  segments, solid horizontal-only gridlines, legend present only from two
  identities up, the AntD `Empty` state, and — re-rendering with a series
  filtered out — survivors keeping their hue. Palette checked with the skill's
  validator against AntD's surfaces in both modes.
- Frontend: `npx tsc --noEmit` passes under `strict`, and `filters.ts` was
  compiled and run against assertions covering param building, blank-value
  omission, nested `dataIndex`, inclusive bounds, same-day ranges and combined
  filters — under `TZ=Asia/Tokyo` and `TZ=America/Los_Angeles` as well as
  locally. Nothing has run in a real browser — there is no app shell or test
  runner here yet, so tick density and label collision (which depend on real
  text measurement) are the one thing the jsdom pass cannot judge.
