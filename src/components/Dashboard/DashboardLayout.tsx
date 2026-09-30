import { Col, Row } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

import { useTufteTheme } from './theme';

/**
 * The page grid: filters, then KPIs, then charts, then the table.
 *
 * That order is the reading order — the filter states the scope, the tiles
 * give the headline under that scope, the charts give its shape, and the table
 * is the evidence you drop to when a chart raises a question. Each band is
 * separated by whitespace rather than by a rule or a card edge, so the only
 * lines on the page belong to the data.
 *
 * The filter bar sits above the KPIs rather than with the table, even though
 * the table is where filtering usually lives: these controls scope the whole
 * page, and a control placed inside one band reads as belonging to that band.
 */

export interface DashboardLayoutProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Page-level buttons, opposite the title. */
  extra?: ReactNode;

  /** Typically a `<FilterBar>` wired to `useFilteredDataset`. */
  filters?: ReactNode;
  /** Typically a `<MetricGrid>`. */
  metrics?: ReactNode;
  /** Each entry gets an equal column; they wrap and stack on narrow screens. */
  charts?: ReactNode[];
  /** Chart columns on a wide screen. Default 2. */
  chartColumns?: 1 | 2 | 3;
  /** Charts that should span the full width, below the grid above. */
  wideCharts?: ReactNode[];
  /** Typically a `<DataTable mode="external">`. */
  table?: ReactNode;

  /** Space between grid cells. Default 32 — charts need air around them. */
  gutter?: number;
  /** Space between bands. Default 40. */
  bandGap?: number;
  style?: CSSProperties;
}

export function DashboardLayout({
  title,
  description,
  extra,
  filters,
  metrics,
  charts = [],
  chartColumns = 2,
  wideCharts = [],
  table,
  gutter = 32,
  bandGap = 40,
  style,
}: DashboardLayoutProps) {
  const theme = useTufteTheme();
  const span = Math.max(1, Math.round(24 / chartColumns));
  const band = { marginTop: bandGap };

  return (
    <div style={style}>
      {(title || description || extra) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            {title && (
              <h2
                style={{
                  fontFamily: theme.fontFamily,
                  fontSize: 20,
                  fontWeight: 500,
                  color: theme.ink,
                  margin: 0,
                }}
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                style={{
                  fontFamily: theme.fontFamily,
                  fontSize: theme.fontSize,
                  color: theme.inkMuted,
                  margin: '4px 0 0',
                }}
              >
                {description}
              </p>
            )}
          </div>
          {extra}
        </div>
      )}

      {filters}

      {metrics && <div style={filters ? band : undefined}>{metrics}</div>}

      {charts.length > 0 && (
        <Row gutter={[gutter, gutter]} style={band}>
          {charts.map((chart, index) => (
            // Index keys: these are layout slots declared in source order, not
            // a reorderable list.
            <Col key={index} xs={24} lg={span}>
              {chart}
            </Col>
          ))}
        </Row>
      )}

      {wideCharts.length > 0 && (
        <Row gutter={[gutter, gutter]} style={band}>
          {wideCharts.map((chart, index) => (
            <Col key={index} xs={24}>
              {chart}
            </Col>
          ))}
        </Row>
      )}

      {table && (
        <Row style={band}>
          <Col span={24}>{table}</Col>
        </Row>
      )}
    </div>
  );
}
