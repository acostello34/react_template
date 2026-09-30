import type { ReactNode } from 'react';

import { IDENTIFIER_KEYS, type Field, type Row } from '../Chart/fields';
import { formatValue, type ValueFormatter } from '../Chart/format';

/**
 * Metric definition and evaluation, kept pure so the numbers on a dashboard
 * can be asserted without rendering one.
 *
 * Every metric is a fold over the *filtered* array. Nothing here caches, and
 * nothing here knows about the previous filter state — a tile is a function of
 * the rows it was handed, which is what makes "the tiles and the table always
 * agree" true by construction rather than by discipline.
 */

export type MetricAggregate = 'count' | 'sum' | 'mean' | 'median' | 'min' | 'max' | 'distinct';

export interface MetricSpec<T = Row> {
  /** Stable identity for the React key. */
  key: string;
  label: ReactNode;
  aggregate: MetricAggregate;
  /** Row key to measure. Required for everything except `count`. */
  field?: string;
  /** A derived measure — `row => row.price * row.stock`. Wins over `field`. */
  value?: (row: T) => number | null | undefined;
  /** Narrows the rows before folding, for "out of stock" style tiles. */
  where?: (row: T) => boolean;
  format?: ValueFormatter;
  /** Small line under the number. A function receives the computed value. */
  caption?: ReactNode | ((value: number, rows: T[]) => ReactNode);
}

function numeric(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'boolean') return input ? 1 : 0;
  if (input === null || input === undefined || input === '') return null;
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function measure<T>(row: T, spec: MetricSpec<T>): number | null {
  if (spec.value) return numeric(spec.value(row));
  if (!spec.field) return null;
  return numeric((row as Row)[spec.field]);
}

export function computeMetric<T extends object>(rows: T[], spec: MetricSpec<T>): number {
  const scoped = spec.where ? rows.filter(spec.where) : rows;
  if (spec.aggregate === 'count') return scoped.length;

  if (spec.aggregate === 'distinct') {
    const seen = new Set<unknown>();
    for (const row of scoped) {
      const cell = spec.value ? spec.value(row) : spec.field ? (row as Row)[spec.field] : undefined;
      if (cell !== null && cell !== undefined && cell !== '') seen.add(cell);
    }
    return seen.size;
  }

  // Non-numeric and missing cells are skipped, not read as zero: a mean over
  // 200 rows where 40 are blank is a mean of 160, and counting the blanks
  // would quietly drag it toward zero.
  const values: number[] = [];
  for (const row of scoped) {
    const value = measure(row, spec);
    if (value !== null) values.push(value);
  }
  if (!values.length) return 0;

  switch (spec.aggregate) {
    case 'sum':
      return values.reduce((total, value) => total + value, 0);
    case 'mean':
      return values.reduce((total, value) => total + value, 0) / values.length;
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = sorted.length >> 1;
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }
    case 'min':
      return Math.min(...values);
    default:
      return Math.max(...values);
  }
}

export function formatMetric<T extends object>(value: number, spec: MetricSpec<T>): string {
  if (spec.format) return spec.format(value);
  // Counts are whole things; there is no such thing as 12.4 records.
  if (spec.aggregate === 'count' || spec.aggregate === 'distinct') {
    return formatValue(Math.round(value));
  }
  return formatValue(value);
}

/** `created_at` -> `Created at`, `totalRevenue` -> `Total revenue`. */
export function humanize(key: string): string {
  const words = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Derives a tile row from the data's own shape, for the zero-config case.
 *
 * The order is deliberate: how many rows, then the total and the average of
 * the first real measure, then the next measure. A count answers "how much did
 * my filter remove"; a sum and a mean of the same field answer "how big" and
 * "how big typically", which is the pair a reader actually compares. Keys that
 * merely identify a row are excluded — the mean of an id is noise.
 */
export function inferMetrics(fields: Field[], limit = 4): MetricSpec<Row>[] {
  const measures = fields.filter(
    (field) => field.type === 'number' && !IDENTIFIER_KEYS.test(field.key) && field.distinct > 1,
  );
  const category = fields
    .filter((field) => field.type === 'category' && !IDENTIFIER_KEYS.test(field.key))
    .sort((a, b) => a.distinct - b.distinct)[0];

  const specs: MetricSpec<Row>[] = [{ key: 'count', label: 'Records', aggregate: 'count' }];

  for (const field of measures) {
    specs.push(
      { key: `sum:${field.key}`, label: `Total ${humanize(field.key).toLowerCase()}`, aggregate: 'sum', field: field.key },
      { key: `mean:${field.key}`, label: `Average ${humanize(field.key).toLowerCase()}`, aggregate: 'mean', field: field.key },
    );
  }

  if (category) {
    specs.push({
      key: `distinct:${category.key}`,
      label: humanize(category.key),
      aggregate: 'distinct',
      field: category.key,
    });
  }

  return specs.slice(0, limit);
}
