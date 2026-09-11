# Phase 6 — Dashboard, Reports & Export

What was built, the decisions behind it, and what deliberately was not built.
Design: [`BLUEPRINT.md`](BLUEPRINT.md) §18–§19, §22.

## Outcome

The layer that answers "how is the portfolio doing". A dashboard of figures the
database can be asked for directly, six charts over twelve months, four
worklists, nine reports with filters, and CSV and PDF downloads of any of them.

No new tables. Phase 6 adds **no migration** — it reads what Phases 2–5 wrote.
That is the point: a report that needed its own storage would be a second copy
of the truth, and the two would eventually disagree.

## The nine reports

| Key | Title | Honours |
|---|---|---|
| `rent-collection` | Rent collection | dateFrom, dateTo, propertyId, unitId, tenantId, paymentMethod |
| `outstanding-rent` | Outstanding rent | dateFrom, dateTo, period, propertyId, unitId, tenantId, status |
| `tenants` | Tenants | propertyId, unitId, status |
| `occupancy` | Occupancy | propertyId |
| `expenses` | Expenses | dateFrom, dateTo, propertyId, category, paymentMethod |
| `income` | Income | dateFrom, dateTo, propertyId |
| `profit-loss` | Profit and loss | dateFrom, dateTo, propertyId |
| `maintenance` | Maintenance | dateFrom, dateTo, propertyId, status |
| `lease-expiry` | Lease expiry | dateFrom, dateTo, propertyId, status |

Each is one class implementing `ReportStrategy`, registered in a `Map` by key.
Every one returns the same shape:

```ts
{ columns: ReportColumn[], rows: ReportRow[], totals: Record<string, string>, meta: { total, page, limit } }
```

The screen, the CSV writer and the PDF renderer all consume that one shape, so
a tenth report is a class on the server and **nothing** on the client — no new
table component, no new export branch, and no opportunity for the printed
figures to drift from the ones on screen.

`GET /reports` returns the catalogue, and each entry names the filters that
report honours. The runner screen renders only those. Offering a filter a
report ignores would have the reader believe the numbers changed when they did
not, which is worse than not offering it.

## The four-layer isolation still applies, unchanged

A report is a read, so it goes through exactly the same guards as every other
read. `buildContext()` is where that is made concrete:

1. **Session → organization.** The org comes from the session, never the query.
2. **Prisma client extension.** Every query is org-filtered before it is sent.
3. **Property scope.** `PropertyScopeService.propertyIds` is `null` for an
   unrestricted user and an **array** for a scoped one — including the empty
   array, which means "sees nothing" and is honoured as such.
4. **A requested `propertyId` is verified to exist through the scoped client.**
   Not through a raw query, and not "filtered and see what comes back".

That last one was a bug this phase's tests caught, and is worth stating: asking
for a property in another organization originally returned an **empty 200**,
because the filter narrowed to nothing and an empty report is a legitimate
answer. Empty and forbidden are different facts, and a probe that gets an empty
200 learns the id exists somewhere. It is a 404 now, the same 404 as every other
cross-organization reference in the product.

## Decisions worth knowing

| Decision | Why |
|---|---|
| **No new tables, no snapshots, no cache** | A pre-aggregated figure is a copy of the truth that starts rotting the moment a payment is voided. Every number here is a SQL aggregate over the live rows |
| Money stays **Decimal in SQL and fixed-scale strings over HTTP** | `SUM()` in PostgreSQL, then `toFixed(2)`. No total is ever computed in JavaScript floating point — a report is the document someone acts on |
| **Totals are for every matching row, not the page** | Computed by a separate aggregate, not by adding up the 50 rows returned. A footer that totals only what is visible is the classic report bug, and the screen says out loud which it is doing |
| The chart series include **empty months** | `generate_series` on the server, so a line never runs straight through a month that had no activity. A gap is information |
| **One axis per chart, never two** | Charged against collected are the same unit and share a scale; money against occupancy do not, so they are two charts. A dual axis can be made to show any relationship you like |
| Net income is a **diverging bar**, not a line | The question is which months were negative. Polarity wants a zero baseline and two hues, with the neutral at zero |
| Every chart carries a **table view** | Three of the series colours sit under 3:1 against the light card. The palette validator warns, and the table is the relief that makes the warning acceptable rather than ignored |
| The export runs **the same guards and the same strategy** as the screen | An export is just another read. A separate query path for downloads is how a scoped user ends up with a spreadsheet of the whole organization |
| CSV cells beginning `=`, `+`, `-`, `@` are **prefixed with an apostrophe** | A tenant name is an execution vector the moment somebody opens the file in Excel. This is the cheapest real vulnerability in the product to get wrong |
| The CSV is written with a **UTF-8 BOM** | Without it Excel on Windows mangles "Wanjiku Njeri". The BOM is written once by the controller, not per chunk |
| Both exports **state their filters in the file** | A printed report that does not say what it covered cannot be checked by the person holding it. A scoped export says so in as many words |
| Export is **paged server-side to a 10,000-row cap** | Streaming, so memory is bounded; capped, so one request cannot be turned into a portfolio-sized download |
| `reports.export` is a **separate permission** from `reports.view` | Reading a figure on screen and walking out with the file are different acts. The matrix already separated them; this phase is where it matters |
| A caretaker gets **an explanation, not an empty dashboard** | Zeros would read as "the portfolio is empty" rather than "this is not yours to see", and those are very different things to tell somebody |

## The charts

Six, built with Recharts against a palette that was validated rather than
chosen by eye:

- **Charged against collected** — grouped bars, two series, one scale
- **Collection trend** — area, one series (no legend; the title names it)
- **Net income** — diverging bars, positive and negative hues either side of zero
- **Occupancy trend** — line, y-axis pinned to 0–100
- **Expenses by category** — horizontal bars, single hue, ranked
- **Property performance** — grouped horizontal bars, collected against expenses

The palette was checked with the validator, not reasoned about: light mode
(surface `#ffffff`, all pairs) passes the lightness band, chroma floor, CVD
separation and normal-vision floor, with one contrast **warning** on the aqua
step — which obliges visible figures elsewhere, satisfied by the table view on
every chart. Dark mode is stepped separately against `#101728` and passes
outright; it is a selected palette, not an inverted one.

Legend and axis text wear text tokens, never the series colour. That was a real
fix this phase, not a precaution — Recharts colours legend labels with the
series by default, which turns identity into colour-alone.

## Two things the reconciliation caught

Beyond the empty-200 bug above:

**The occupancy axis was clipping its own labels.** A negative left margin,
copied across the charts, cropped "100%" to "!0%" on the only chart whose axis
reaches three digits. It is the kind of defect no unit test sees and a
screenshot catches in a second — which is why the last step of building a chart
is to render it and look at it.

**The report slug was leaking into the breadcrumb.** `Outstanding-rent` rather
than `Outstanding rent`. Small, but a URL fragment on screen is a sign nobody
read the page.

## Test coverage added

**Unit** — 12 new (144 total): CSV escaping and the formula-injection guard,
including the case that needs *both* the apostrophe and CSV quoting, null and
undefined rendered as empty rather than the string "null", and CRLF line ends.

**Integration** — a new `insights.e2e-spec.ts` of 33 tests, plus six Phase 6
rows added to the permissions matrix (397 total). The reconciliation tests do
not assert that a number is *a* number; each one computes the expected figure
from the database in the test and compares:

- Dashboard: portfolio counts against the unit table; collected, outstanding
  and net income against their own aggregates; the property filter narrowing
  them; a cross-organization property refused
- Charts: one row per month including empty ones; each month's net computed
  from that month's own figures; an unreasonable window rejected rather than built
- Reports: all nine run; rent collection totals every completed payment and
  **drops a voided one the moment it is voided**; outstanding totals every
  positive balance; occupancy agrees with the unit table per property and
  overall; profit and loss is collected minus spent and its rows sum to its
  total; income's collection rate matches the dashboard's
- Paging: totals cover every matching row, not the returned page
- Exports: CSV states its filters and matches the report row for row; the PDF is
  a real PDF; an unknown format is refused rather than guessed; `reports.export`
  is required and `reports.view` is not enough
- Scope and isolation: a scoped user gets their own figures, a scoped user with
  **no** assignments gets zeros rather than the organization, the export says it
  is scoped, a cross-organization filter is a 404, one organization's numbers
  never appear in another's, and every route is 401 without a session

**End-to-end** — 6 Playwright journeys: the dashboard showing the exact money
put in earlier in the same journey (30,000 charged, 20,000 collected, 10,000
owing, 12,500 spent, 7,500 net, 67% collected, 1 of 2 units let); every chart
readable as a table; the worklists naming the payment and its receipt; a report
run and downloaded as CSV; an empty report saying so plainly; and profit and
loss doing the same arithmetic the dashboard tile does.

Full suite: **144 unit, 397 integration and 70 Playwright** tests (one mobile-only,
skipped on desktop), all passing.

## Screens

`/dashboard` — eight stat tiles, six charts, four worklists, with period and
property filters in the header. `/reports` — a card per report with the filter
count. `/reports/[report]` — one renderer for all nine, driven by the columns
the API declares, with CSV and PDF buttons for anyone holding `reports.export`.

Downloads go through the API client so the session cookie travels with them; a
plain `<a href>` would be an anonymous request and get a 401, which is correct.

## Not built in Phase 6

Stated plainly rather than stubbed:

- **No scheduled or emailed reports.** There is no email delivery in V1 at all
- **No saved report definitions or custom report builder.** Nine fixed reports
- **No Excel (.xlsx) export.** CSV and PDF. A real xlsx writer is a dependency
  and a format, not an afternoon
- **No drill-through from a chart to the rows behind it.** The table view shows
  the figures; it does not link to the records
- **No comparison periods** (this month against last) beyond the twelve-month
  series the charts already draw
- **No forecasting, no trend projection, no anomaly detection.** Every figure
  here is something that happened, not something predicted
- **No caching or materialised views.** Deliberate, per the table above. If a
  portfolio ever grows large enough to need them, the strategy interface is the
  seam to put them behind

## Verified on

PostgreSQL 16, Node 22, `pnpm 9`. No migration in this phase. The reports were
additionally reconciled against the demo seed with a live script: all nine
agree with the database exactly, including a scoped accountant seeing 14 of 30
units and 785,000.00 of the organization's 1,970,400.00.
