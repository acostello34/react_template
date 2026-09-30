import { Card, Empty, Segmented, Space, Spin, Table, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as PieSlice,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { ApiResponse } from '../../api';
import { ChartLegend, ChartTooltip } from './ChartChrome';
import { inferChartKeys, inferFields, type Row } from './fields';
import { formatCompact, formatValue, type ValueFormatter } from './format';
import { OTHER_LABEL, useChartTheme, useSeriesColors } from './palette';
import { prepareChartData, type Aggregate, type Bucket, type SortMode } from './prepare';

export type ChartKind = 'bar' | 'stackedBar' | 'line' | 'area' | 'pie';

export interface DataChartProps<T extends object> {
  /** The endpoint's envelope or a bare array — both are accepted. */
  data: ApiResponse<T[]> | T[] | null | undefined;

  /** Defaults to a line over a date axis (a trend) and bars otherwise. */
  kind?: ChartKind;
  /** Payload key for the x axis. Inferred from the data when omitted. */
  x?: string;
  /** Payload key(s) to measure. Several keys must share one scale. */
  y?: string | string[];
  aggregate?: Aggregate;
  /** Payload key to split into one series per distinct value. */
  splitBy?: string;
  /** Bucket size for a date x. Default 'month'. */
  bucket?: Bucket;

  title?: ReactNode;
  description?: ReactNode;
  height?: number;
  loading?: boolean;
  /** Plot area height in px. The axis band is included by the container. */
  valueFormat?: ValueFormatter;
  sort?: SortMode;
  /** Series past this fold into "Other". Capped at 8 — hues are never generated. */
  maxSeries?: number;
  maxCategories?: number;
  /**
   * Full set of series names, so a filtered-away series keeps its color and
   * the survivors are never repainted. Without it, order of first appearance.
   */
  colorDomain?: string[];
  extra?: ReactNode;
  emptyText?: string;
  /** false renders bare, for embedding in a Card you already have. */
  card?: boolean;
}

/** Envelope, bare array, or nothing — normalize before looking at keys. */
function toRows<T extends object>(data: DataChartProps<T>['data']): Row[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as Row[];
  return (Array.isArray(data.data) ? data.data : []) as Row[];
}

/**
 * How much of the result set the chart is actually showing.
 *
 * A paginated endpoint hands back one page; charting it silently would let a
 * reader take "page 1 of 12" for the whole picture, so the coverage is stated
 * under the title whenever it isn't the full set.
 */
function coverage<T extends object>(
  data: DataChartProps<T>['data'],
  shown: number,
): { shown: number; total: number } | null {
  if (!data || Array.isArray(data)) return null;
  const total = data.metadata?.pagination?.total_items;
  if (typeof total !== 'number' || total <= shown) return null;
  return { shown, total };
}

/**
 * Stacked segments are separated by a 2px gap in the surface color rather than
 * by a stroke: white does the separating, so no non-data ink is added.
 */
function GappedBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  radius?: number | [number, number, number, number];
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill, radius } = props;
  if (height <= 0 || width <= 0) return null;
  const gap = Math.min(2, height);
  const corner = Array.isArray(radius) ? radius[0] : (radius ?? 0);
  return (
    <rect x={x} y={y + gap} width={width} height={height - gap} rx={corner} ry={corner} fill={fill} />
  );
}

export function DataChart<T extends object>({
  data,
  kind,
  x,
  y,
  aggregate = 'sum',
  splitBy,
  bucket = 'month',
  title,
  description,
  height = 260,
  loading = false,
  valueFormat = formatValue,
  sort = 'value',
  maxSeries = 6,
  maxCategories = 12,
  colorDomain,
  extra,
  emptyText = 'No data',
  card = true,
}: DataChartProps<T>) {
  const theme = useChartTheme();
  const [view, setView] = useState<'Chart' | 'Table'>('Chart');

  const rows = useMemo(() => toRows(data), [data]);
  const fields = useMemo(() => inferFields(rows), [rows]);
  const defaults = useMemo(() => inferChartKeys(fields), [fields]);

  const xKey = x ?? defaults.x;
  const yKey = y ?? (aggregate === 'count' ? undefined : defaults.y);

  const prepared = useMemo(
    () =>
      xKey
        ? prepareChartData(rows, fields, {
            x: xKey,
            y: yKey,
            aggregate,
            splitBy,
            bucket,
            // Never more slots than the palette has: the ninth hue doesn't exist.
            maxSeries: Math.min(maxSeries, theme.series.length),
            maxCategories,
            sort,
          })
        : null,
    [rows, fields, xKey, yKey, aggregate, splitBy, bucket, maxSeries, maxCategories, sort, theme],
  );

  // The data's job picks the form: a date axis is read as a trend.
  const chartKind: ChartKind = kind ?? (prepared?.xType === 'date' ? 'line' : 'bar');

  const series = prepared?.series ?? [];
  // A pie's identity channel is its slices, not its (single) series, so the
  // stable color map is keyed by slice label there.
  const colorKeys =
    chartKind === 'pie' ? (prepared?.rows.map((row) => String(row.__x)) ?? []) : series;
  const colors = useSeriesColors(colorKeys, theme, colorDomain);
  const page = coverage(data, rows.length);

  const axisTick = { fill: theme.inkMuted, fontSize: theme.fontSize, fontFamily: theme.fontFamily };
  const tooltip = (
    <Tooltip
      content={<ChartTooltip theme={theme} format={valueFormat} />}
      cursor={
        chartKind === 'bar' || chartKind === 'stackedBar'
          ? { fill: theme.ink, fillOpacity: 0.04 }
          : { stroke: theme.axis, strokeWidth: 1 }
      }
    />
  );
  // A legend is mandatory from two identities up, and pointless at one: with a
  // single series the title already names what is plotted. For a pie the
  // identities are the slices.
  const identities = chartKind === 'pie' ? (prepared?.rows.length ?? 0) : series.length;
  const legend =
    identities > 1 ? (
      <Legend
        content={<ChartLegend theme={theme} shape={chartKind === 'line' ? 'line' : 'rect'} />}
      />
    ) : null;

  const axes = (
    <>
      {/* Hairline, solid, horizontal only — recessive by design. */}
      <CartesianGrid vertical={false} stroke={theme.grid} />
      <XAxis
        dataKey="__x"
        tick={axisTick}
        tickLine={false}
        tickMargin={8}
        axisLine={{ stroke: theme.axis }}
        interval={prepared?.xType === 'date' ? 'preserveStartEnd' : 0}
        minTickGap={8}
      />
      <YAxis
        tick={axisTick}
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={formatCompact}
      />
    </>
  );

  const margin = { top: 8, right: 8, bottom: 0, left: 0 };

  function renderChart() {
    const chartRows = prepared?.rows ?? [];

    if (chartKind === 'pie') {
      const measure = series[0];
      return (
        <PieChart margin={margin}>
          {tooltip}
          {legend}
          <Pie
            data={chartRows}
            dataKey={measure}
            nameKey="__x"
            innerRadius="55%"
            outerRadius="80%"
            // The 2px separation is the surface color, same as everywhere else.
            stroke={theme.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {chartRows.map((row) => (
              <PieSlice key={row.__x} fill={colors[String(row.__x)]} />
            ))}
          </Pie>
        </PieChart>
      );
    }

    if (chartKind === 'line' || chartKind === 'area') {
      const Chart = chartKind === 'line' ? LineChart : AreaChart;
      // Markers become noise past a couple of dozen points; the active dot and
      // the crosshair still give every point a readout.
      const showDots = chartRows.length <= 24;
      return (
        <Chart data={chartRows} margin={margin}>
          {axes}
          {tooltip}
          {legend}
          {series.map((name) =>
            chartKind === 'line' ? (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={colors[name]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                // A 2px ring in the surface color keeps a dot legible where it
                // crosses its own line or a neighbour's.
                dot={showDots ? { r: 4, fill: colors[name], stroke: theme.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: colors[name], stroke: theme.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ) : (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stroke={colors[name]}
                strokeWidth={2}
                fill={colors[name]}
                fillOpacity={0.1}
                dot={showDots ? { r: 4, fill: colors[name], stroke: theme.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 5, fill: colors[name], stroke: theme.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ),
          )}
        </Chart>
      );
    }

    const stacked = chartKind === 'stackedBar';
    return (
      <BarChart data={chartRows} margin={margin} barGap={2} barCategoryGap="22%">
        {axes}
        {tooltip}
        {legend}
        {series.map((name, index) => (
          <Bar
            key={name}
            dataKey={name}
            fill={colors[name]}
            stackId={stacked ? 'stack' : undefined}
            // Bars are capped rather than filling the band: the leftover is air.
            maxBarSize={24}
            // 4px rounded data-end, square at the baseline. On a stack only the
            // topmost segment carries the rounded end.
            radius={stacked ? (index === series.length - 1 ? [4, 4, 0, 0] : 0) : [4, 4, 0, 0]}
            shape={stacked ? <GappedBar /> : undefined}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  }

  const hasRows = Boolean(prepared?.rows.length);

  const notes = [
    page ? `Showing ${page.shown} of ${page.total} rows (current page).` : null,
    prepared?.foldedCategories
      ? `${prepared.foldedCategories} smaller categories folded into “${OTHER_LABEL}”.`
      : null,
    prepared?.foldedSeries
      ? `${prepared.foldedSeries} smaller series folded into “${OTHER_LABEL}”.`
      : null,
  ].filter(Boolean);

  const body = (
    <>
      {(description || notes.length > 0) && (
        <div style={{ marginBottom: 8 }}>
          {description && (
            <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: theme.fontSize }}>
              {description}
            </Typography.Paragraph>
          )}
          {notes.map((note) => (
            <Typography.Text key={String(note)} type="secondary" style={{ fontSize: theme.fontSize }}>
              {note}
            </Typography.Text>
          ))}
        </div>
      )}

      <div
        style={{
          height,
          // Refetch holds the previous render at reduced opacity: no skeleton
          // flash, no layout jump, and the frame stays put.
          opacity: loading && hasRows ? 0.55 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        {!hasRows ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {loading ? <Spin /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />}
          </div>
        ) : view === 'Chart' ? (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        ) : (
          <div style={{ height: '100%', overflow: 'auto' }}>
            {/* The table view is the chart's WCAG-clean twin: every plotted
                value is readable without hovering, and it is what discharges
                the light-mode contrast relief the palette requires. */}
            <Table
              size="small"
              rowKey="__x"
              dataSource={prepared?.rows}
              pagination={false}
              columns={[
                { title: xKey ?? 'Group', dataIndex: '__x', key: '__x' },
                ...series.map((name) => ({
                  title: name,
                  dataIndex: name,
                  key: name,
                  align: 'right' as const,
                  render: (value: number) => valueFormat(Number(value)),
                })),
              ]}
            />
          </div>
        )}
      </div>
    </>
  );

  const toggle = (
    <Space size="small">
      {extra}
      <Segmented
        size="small"
        options={['Chart', 'Table']}
        value={view}
        onChange={(value) => setView(value as 'Chart' | 'Table')}
      />
    </Space>
  );

  if (!card) return body;

  return (
    <Card size="small" title={title} extra={toggle}>
      {body}
    </Card>
  );
}
