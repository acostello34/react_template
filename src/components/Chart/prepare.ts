import dayjs from 'dayjs';

import { OTHER_LABEL } from './palette';
import type { Field, FieldType, Row } from './fields';

/**
 * Turns raw DataFrame rows into chart-ready rows.
 *
 * The endpoint returns one record per entity; a chart needs one record per
 * x-position with a column per series. Everything that has to happen in
 * between — grouping, aggregating, pivoting, folding the tail, ordering — is
 * here as pure functions, so it can be tested without rendering anything.
 */

export type Aggregate = 'sum' | 'mean' | 'count' | 'min' | 'max';
export type Bucket = 'day' | 'week' | 'month' | 'year';
export type SortMode = 'value' | 'label' | 'none';

export interface PrepareSpec {
  x: string;
  /** One series per key when an array. They must share a scale — never a second axis. */
  y?: string | string[];
  aggregate?: Aggregate;
  /** Splits a single measure into one series per distinct value of this key. */
  splitBy?: string;
  bucket?: Bucket;
  /** Series past this fold into "Other" rather than claiming a 9th hue. Default 6. */
  maxSeries?: number;
  /** X categories past this fold into "Other". Default 12. */
  maxCategories?: number;
  sort?: SortMode;
}

export interface ChartRow {
  /** Rendered x label. Prefixed to stay clear of the payload's own keys. */
  __x: string;
  /** Chronological or ordinal position, used for sorting only. */
  __order: number;
  [series: string]: string | number;
}

export interface Prepared {
  rows: ChartRow[];
  series: string[];
  xType: FieldType;
  /** How many series/categories were folded into "Other" (0 when none). */
  foldedSeries: number;
  foldedCategories: number;
}

interface Cell {
  sum: number;
  count: number;
  min: number;
  max: number;
}

const BUCKET_FORMAT: Record<Bucket, string> = {
  day: 'D MMM YYYY',
  week: 'D MMM YYYY',
  month: 'MMM YYYY',
  year: 'YYYY',
};

function emptyCell(): Cell {
  return { sum: 0, count: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
}

function accumulate(cell: Cell, value: number | null): void {
  cell.count += 1;
  if (value === null) return;
  cell.sum += value;
  cell.min = Math.min(cell.min, value);
  cell.max = Math.max(cell.max, value);
}

function finalize(cell: Cell, aggregate: Aggregate): number {
  switch (aggregate) {
    case 'count':
      return cell.count;
    case 'mean':
      return cell.count ? cell.sum / cell.count : 0;
    case 'min':
      return Number.isFinite(cell.min) ? cell.min : 0;
    case 'max':
      return Number.isFinite(cell.max) ? cell.max : 0;
    default:
      return cell.sum;
  }
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Label plus a sortable position for one x value. */
function xPosition(
  value: unknown,
  type: FieldType,
  bucket: Bucket | undefined,
): { label: string; order: number } {
  if (value === null || value === undefined || value === '') {
    return { label: '—', order: Number.POSITIVE_INFINITY };
  }

  if (type === 'date') {
    const unit = bucket ?? 'month';
    const start = dayjs(value as string).startOf(unit === 'week' ? 'week' : unit);
    if (!start.isValid()) return { label: String(value), order: Number.POSITIVE_INFINITY };
    return { label: start.format(BUCKET_FORMAT[unit]), order: start.valueOf() };
  }

  if (type === 'boolean') return { label: value ? 'Yes' : 'No', order: value ? 0 : 1 };
  if (type === 'number') return { label: String(value), order: Number(value) };
  return { label: String(value), order: 0 };
}

/**
 * Keeps the largest `limit` names and reports the rest, so the caller can fold
 * them into a single "Other" bucket. Ties break alphabetically for stability —
 * two renders of the same data must not disagree about which names survive.
 */
function topNames(totals: Map<string, number>, limit: number): Set<string> {
  return new Set(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([name]) => name),
  );
}

export function prepareChartData(
  rows: Row[],
  fields: Field[],
  spec: PrepareSpec,
): Prepared {
  const {
    x,
    y,
    aggregate = 'sum',
    splitBy,
    bucket,
    maxSeries = 6,
    maxCategories = 12,
    sort = 'value',
  } = spec;

  const xType = fields.find((field) => field.key === x)?.type ?? 'category';
  const measures = y === undefined ? [] : Array.isArray(y) ? y : [y];
  const counting = aggregate === 'count' || measures.length === 0;

  // Pass 1: bucket every row into (x, series) cells, tracking totals so the
  // fold decisions below are made on real magnitudes.
  const cells = new Map<string, Map<string, Cell>>();
  const order = new Map<string, number>();
  const seriesTotals = new Map<string, number>();
  const categoryTotals = new Map<string, number>();

  for (const row of rows) {
    const { label, order: position } = xPosition(row[x], xType, bucket);
    if (!cells.has(label)) {
      cells.set(label, new Map());
      order.set(label, position);
    }
    const column = cells.get(label) as Map<string, Cell>;

    const contributions: [string, number | null][] = counting
      ? [[splitBy ? String(row[splitBy] ?? '—') : 'Count', null]]
      : measures.map((measure) => [
          splitBy ? String(row[splitBy] ?? '—') : measure,
          numeric(row[measure]),
        ]);

    for (const [series, value] of contributions) {
      if (!column.has(series)) column.set(series, emptyCell());
      accumulate(column.get(series) as Cell, value);

      const magnitude = Math.abs(value ?? 1);
      seriesTotals.set(series, (seriesTotals.get(series) ?? 0) + magnitude);
      categoryTotals.set(label, (categoryTotals.get(label) ?? 0) + magnitude);
    }
  }

  // Pass 2: decide what survives. Folding beats generating a 9th hue, and a
  // bar chart with 60 categories is a table, not a chart.
  const keptSeries = topNames(seriesTotals, maxSeries);
  const foldedSeries = Math.max(seriesTotals.size - keptSeries.size, 0);

  const foldCategories = xType === 'category' && cells.size > maxCategories;
  const keptCategories = foldCategories ? topNames(categoryTotals, maxCategories) : null;
  const foldedCategories = foldCategories ? cells.size - (keptCategories as Set<string>).size : 0;

  // Pass 3: fold, then flatten each x into one wide row.
  const merged = new Map<string, Map<string, Cell>>();
  const mergedOrder = new Map<string, number>();

  for (const [label, column] of cells) {
    const outLabel = keptCategories && !keptCategories.has(label) ? OTHER_LABEL : label;
    if (!merged.has(outLabel)) {
      merged.set(outLabel, new Map());
      mergedOrder.set(
        outLabel,
        outLabel === OTHER_LABEL ? Number.POSITIVE_INFINITY : (order.get(label) as number),
      );
    }
    const target = merged.get(outLabel) as Map<string, Cell>;

    for (const [series, cell] of column) {
      const outSeries = keptSeries.has(series) ? series : OTHER_LABEL;
      if (!target.has(outSeries)) target.set(outSeries, emptyCell());
      const existing = target.get(outSeries) as Cell;
      existing.sum += cell.sum;
      existing.count += cell.count;
      existing.min = Math.min(existing.min, cell.min);
      existing.max = Math.max(existing.max, cell.max);
    }
  }

  const seriesNames = [
    ...[...keptSeries].sort(
      (a, b) => (seriesTotals.get(b) ?? 0) - (seriesTotals.get(a) ?? 0) || a.localeCompare(b),
    ),
    ...(foldedSeries ? [OTHER_LABEL] : []),
  ];

  const out: ChartRow[] = [...merged.entries()].map(([label, column]) => {
    const row: ChartRow = { __x: label, __order: mergedOrder.get(label) as number };
    for (const series of seriesNames) {
      const cell = column.get(series);
      row[series] = cell ? finalize(cell, counting ? 'count' : aggregate) : 0;
    }
    return row;
  });

  sortRows(out, sort, xType, seriesNames);

  return { rows: out, series: seriesNames, xType, foldedSeries, foldedCategories };
}

function rowTotal(row: ChartRow, series: string[]): number {
  return series.reduce((total, name) => total + Math.abs(Number(row[name]) || 0), 0);
}

function sortRows(rows: ChartRow[], sort: SortMode, xType: FieldType, series: string[]): void {
  // Time and numeric axes are always read in their own order; sorting those by
  // value would turn a trend into nonsense.
  if (xType === 'date' || xType === 'number' || sort === 'none') {
    rows.sort((a, b) => a.__order - b.__order);
    return;
  }
  if (sort === 'label') {
    rows.sort((a, b) => a.__x.localeCompare(b.__x));
  } else {
    rows.sort((a, b) => rowTotal(b, series) - rowTotal(a, series));
  }
  // "Other" is a remainder, so it reads last whatever the ordering.
  rows.sort((a, b) => Number(a.__x === OTHER_LABEL) - Number(b.__x === OTHER_LABEL));
}
