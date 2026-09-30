/**
 * Key inference over a JSON payload.
 *
 * The endpoint returns DataFrame rows — a flat array of records whose keys
 * aren't known at build time. This module reads the shape back off the data so
 * a chart can be described in terms of those keys ("x by category, mean of
 * price") and so sensible defaults exist when it isn't described at all.
 */

export type FieldType = 'number' | 'category' | 'date' | 'boolean';

export interface Field {
  key: string;
  type: FieldType;
  /** Distinct non-null values seen in the sample. */
  distinct: number;
  /** True when any sampled row had null/undefined for this key. */
  nullable: boolean;
}

export type Row = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

/** Keys that identify a row rather than describe it — never chart defaults. */
export const IDENTIFIER_KEYS = /^(id|_id|uuid|key|sku|code|slug)$/i;

function classify(value: unknown): FieldType | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : null;
  if (typeof value === 'string') return ISO_DATE.test(value) ? 'date' : 'category';
  return null;
}

/**
 * Infers a field per key from a sample of rows.
 *
 * Sampling rather than a full scan: a page of rows is plenty to type the keys,
 * and this runs on every render of a table-sized payload.
 */
export function inferFields(rows: Row[], sampleSize = 100): Field[] {
  if (!rows.length) return [];

  const sample = rows.slice(0, sampleSize);
  const keys = new Set<string>();
  for (const row of sample) for (const key of Object.keys(row)) keys.add(key);

  return [...keys].map((key) => {
    const counts: Partial<Record<FieldType, number>> = {};
    const values = new Set<unknown>();
    let nullable = false;

    for (const row of sample) {
      const type = classify(row[key]);
      if (type === null) {
        nullable = true;
        continue;
      }
      counts[type] = (counts[type] ?? 0) + 1;
      values.add(row[key]);
    }

    // Mixed columns settle on the most common type; a numeric column with one
    // stray string is still numeric.
    const type =
      (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] as FieldType) ?? 'category';

    return { key, type, distinct: values.size, nullable };
  });
}

export function fieldsByKey(fields: Field[]): Record<string, Field> {
  return Object.fromEntries(fields.map((field) => [field.key, field]));
}

export interface ChartDefaults {
  x?: string;
  y?: string;
  /** No numeric field worth summing -> count rows instead. */
  countOnly: boolean;
}

/**
 * Picks an x and y when the call site didn't name them.
 *
 * A date field wins x (a trend is almost always the intended reading of one),
 * otherwise the lowest-cardinality categorical — the one that produces a
 * readable number of bars rather than 240 of them.
 */
export function inferChartKeys(fields: Field[]): ChartDefaults {
  const usable = fields.filter((field) => !IDENTIFIER_KEYS.test(field.key));

  const date = usable.find((field) => field.type === 'date');
  const categorical = usable
    .filter((field) => field.type === 'category' && field.distinct > 1 && field.distinct <= 25)
    .sort((a, b) => a.distinct - b.distinct)[0];
  const boolean = usable.find((field) => field.type === 'boolean');

  const x = date?.key ?? categorical?.key ?? boolean?.key;
  const y = usable.find((field) => field.type === 'number')?.key;

  return { x, y, countOnly: y === undefined };
}
