import type { CSSProperties } from 'react';

import type { ValueFormatter } from './format';
import type { ChartTheme } from './palette';

/**
 * Tooltip and legend, built by hand rather than with Recharts' defaults.
 *
 * Two rules drive the layout. In the tooltip the *value* is the strong
 * element and the series name is secondary — the reader already knows which
 * series they pointed at and wants the number. And text never wears the data
 * color: identity comes from a small colored key beside it, so a light hue
 * stays legible as a mark without becoming illegible as text.
 */

interface TooltipEntry {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  theme: ChartTheme;
  format: ValueFormatter;
}

export function ChartTooltip({ active, payload, label, theme, format }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  // Descending, so the reader's eye lands on the biggest contributor first.
  const entries = payload
    .filter((entry) => entry.value !== undefined && entry.value !== null)
    .sort((a, b) => Number(b.value) - Number(a.value));

  if (!entries.length) return null;

  const surface: CSSProperties = {
    background: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.borderRadius,
    boxShadow: theme.boxShadow,
    padding: '8px 12px',
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    minWidth: 160,
  };

  return (
    <div style={surface} role="tooltip">
      <div style={{ color: theme.inkSecondary, marginBottom: 6 }}>{label}</div>
      {entries.map((entry) => (
        <div
          key={String(entry.dataKey ?? entry.name)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '20px' }}
        >
          {/* A line key, not a filled box: at tooltip density a box is
              data-weight ink doing a label's job. */}
          <span
            aria-hidden
            style={{
              width: 12,
              height: 2,
              borderRadius: 1,
              background: entry.color,
              flex: '0 0 auto',
            }}
          />
          <span style={{ color: theme.inkSecondary, flex: 1 }}>{entry.name}</span>
          <span style={{ color: theme.ink, fontWeight: 600 }}>{format(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}

interface LegendEntry {
  value?: string | number;
  color?: string;
}

export interface ChartLegendProps {
  payload?: LegendEntry[];
  theme: ChartTheme;
  /** Mirror the mark: a line for lines, a swatch for bars, areas and slices. */
  shape: 'line' | 'rect';
}

export function ChartLegend({ payload, theme, shape }: ChartLegendProps) {
  if (!payload?.length) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 16px',
        justifyContent: 'center',
        padding: '4px 8px 0',
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize,
        color: theme.inkSecondary,
      }}
    >
      {payload.map((entry) => (
        <span key={String(entry.value)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-hidden
            style={{
              background: entry.color,
              flex: '0 0 auto',
              ...(shape === 'line'
                ? { width: 14, height: 2, borderRadius: 1 }
                : { width: 10, height: 10, borderRadius: 2 }),
            }}
          />
          {entry.value}
        </span>
      ))}
    </div>
  );
}
