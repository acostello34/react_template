/** Number formatting shared by axis ticks, tooltips, labels and the table view. */

const COMPACT = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const FULL = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export type ValueFormatter = (value: number) => string;

/** Axis ticks: 12.9K rather than 12,900 — ticks are read, not audited. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.abs(value) >= 1000 ? COMPACT.format(value) : FULL.format(value);
}

/** Tooltips and the table view, where the exact number is the point. */
export function formatValue(value: number): string {
  return Number.isFinite(value) ? FULL.format(value) : '—';
}

export function currencyFormatter(currency = 'USD'): ValueFormatter {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });
  return (value) => (Number.isFinite(value) ? formatter.format(value) : '—');
}
