import { Col, Row } from 'antd';
import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { Field, Row as DataRow } from '../Chart/fields';
import { inferFields } from '../Chart/fields';
import { useTufteTheme } from './theme';
import { computeMetric, formatMetric, inferMetrics, type MetricSpec } from './metrics';

/**
 * The headline row.
 *
 * Deliberately not `<Card><Statistic/></Card>`. A card draws a border, a
 * radius, a shadow and ~40px of padding around four numbers — four rectangles
 * of non-data ink whose only message is "these are grouped", which the grid
 * already says. Whitespace separates them instead.
 *
 * What is left is a hierarchy in type alone: a small recessive label, the
 * number at display size in primary ink, and an optional caption below it.
 * Figures are `tabular-nums` so the digits line up column-wise between tiles —
 * a scanning reader compares magnitudes by edge position, and proportional
 * digits break that.
 */

export interface MetricGridProps<T extends object> {
  /** The filtered array. Same reference the charts and table read. */
  data: T[];
  /** Omit to derive a sensible row from the data's own shape. */
  metrics?: MetricSpec<T>[];
  /** Inferred from `data` when absent; pass the dataset's to skip the work. */
  fields?: Field[];
  /** Tiles per row on a wide screen. Default 4. */
  columns?: number;
  loading?: boolean;
  /** Right-align the figures. Sensible when every tile is a currency. */
  align?: 'left' | 'right';
  /** Hairline vertical rules between tiles. Off — the gutter usually suffices. */
  divided?: boolean;
  gutter?: number;
}

export function MetricGrid<T extends object>({
  data,
  metrics,
  fields,
  columns = 4,
  loading = false,
  align = 'left',
  divided = false,
  gutter = 32,
}: MetricGridProps<T>) {
  const theme = useTufteTheme();

  const inferred = useMemo(
    () => fields ?? (metrics ? [] : inferFields(data as DataRow[])),
    [fields, metrics, data],
  );

  const specs = useMemo(
    () => metrics ?? (inferMetrics(inferred, columns) as unknown as MetricSpec<T>[]),
    [metrics, inferred, columns],
  );

  const span = Math.max(1, Math.round(24 / Math.max(1, columns)));

  const label: CSSProperties = {
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    lineHeight: '20px',
    color: theme.inkSecondary,
    // A whisper of tracking is what makes a small label read as a label
    // without resorting to uppercase, which shouts and costs legibility.
    letterSpacing: '0.02em',
  };

  const figure: CSSProperties = {
    fontFamily: theme.fontFamily,
    fontSize: 30,
    lineHeight: '40px',
    fontWeight: 500,
    color: theme.ink,
    fontVariantNumeric: 'tabular-nums',
    // Optical alignment: display-size digits carry more side bearing than the
    // label above them, so the two left edges disagree without this.
    marginLeft: align === 'left' ? -1 : 0,
  };

  const caption: CSSProperties = {
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    lineHeight: '20px',
    color: theme.inkMuted,
  };

  return (
    <Row
      gutter={[gutter, 24]}
      // A refetch dims in place rather than collapsing to skeletons: the
      // figures stay readable and nothing below them moves.
      style={{ opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s ease' }}
    >
      {specs.map((spec, index) => {
        const value = computeMetric(data, spec);
        const text =
          typeof spec.caption === 'function' ? spec.caption(value, data) : spec.caption;

        return (
          <Col key={spec.key} xs={24} sm={12} lg={span}>
            <div
              style={{
                textAlign: align,
                paddingLeft: divided && index > 0 ? gutter / 2 : 0,
                borderLeft:
                  divided && index > 0 ? `1px solid ${theme.grid}` : undefined,
              }}
            >
              <div style={label}>{spec.label}</div>
              <div style={figure}>{formatMetric(value, spec)}</div>
              {text !== undefined && text !== null && <div style={caption}>{text as ReactNode}</div>}
            </div>
          </Col>
        );
      })}
    </Row>
  );
}
