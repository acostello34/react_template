import { Empty, Segmented, Space, Spin, Table } from 'antd';
import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartLegend, ChartTooltip } from '../Chart/ChartChrome';
import { inferChartKeys, inferFields, type Field, type Row } from '../Chart/fields';
import { formatCompact, formatValue, type ValueFormatter } from '../Chart/format';
import { useSeriesColors } from '../Chart/palette';
import { prepareChartData, type Aggregate, type Bucket, type SortMode } from '../Chart/prepare';
import { useTufteTheme } from './theme';

/**
 * Line and bar wrappers stripped to data ink.
 *
 * What was removed and why — every one of these is ink that carried no value:
 *
 *  - **Axis lines.** A tick label already marks its position; the rule joining
 *    them says nothing the labels don't.
 *  - **Vertical gridlines.** The x positions are named in words below the
 *    plot. Nothing is looked up along them.
 *  - **Tick marks.** Same argument as the axis line, once per tick.
 *  - **Tick density.** Four y ticks, not the eight Recharts defaults to. Ticks
 *    are for orders of magnitude; the exact number is in the tooltip and the
 *    table view.
 *  - **Area fills under lines.** A filled region encodes an integral. On a
 *    mean or a count that integral is meaningless, so the fill is decoration
 *    that also darkens half the plot.
 *  - **Bar outlines.** An outline on a filled shape is a second edge drawn on
 *    an edge that already exists.
 *  - **Animation.** Motion on mount is ink in the time dimension, and it makes
 *    a filter change read as a transition rather than as a new fact.
 *
 * What was kept: horizontal gridlines at hairline weight (a bar's height is
 * genuinely read against them), the hover layer, and the table view. The
 * gridlines can go too with `grid={false}` if you want the pure range-frame
 * look; the other two are accessibility, not decoration.
 *
 * Aggregation is not reimplemented here — `prepareChartData` from the Chart
 * module does it, so these charts and `<DataChart>` cannot disagree about what
 * "mean of price by category" means.
 */

export interface TufteChartProps<T extends object> {
  /** The filtered array, bare. Same reference the KPI tiles and table read. */
  data: T[];

  /** Row key for the x axis. Inferred from the data when omitted. */
  x?: string;
  /** Row key(s) to measure. Several keys must share one scale — never two axes. */
  y?: string | string[];
  aggregate?: Aggregate;
  /** Splits the measure into one series per distinct value of this key. */
  splitBy?: string;
  /** Bucket size for a date x. Default 'month'. */
  bucket?: Bucket;
  /** Pass the dataset's inferred fields to skip re-inferring per chart. */
  fields?: Field[];

  title?: ReactNode;
  description?: ReactNode;
  /** Plot height in px. Default 220. */
  height?: number;
  loading?: boolean;
  valueFormat?: ValueFormatter;
  sort?: SortMode;
  maxSeries?: number;
  maxCategories?: number;
  /** Fixes color assignment up front so a filtered-away series never repaints. */
  colorDomain?: string[];

  /** Override the muted primary. Ignored once there are two or more series. */
  color?: string;
  /** Hairline horizontal gridlines. Default true; false for the pure look. */
  grid?: boolean;
  /** Y ticks. Default 4. */
  tickCount?: number;
  /**
   * Label the data instead of the axis. On a line that is the last point only;
   * on bars it is every bar, and the y axis is dropped as redundant.
   * Default: on for a single-series line, off for bars.
   */
  directLabels?: boolean;
  /** The chart's accessible twin. Default true. */
  tableView?: boolean;
  emptyText?: string;
  extra?: ReactNode;
}

interface InternalProps<T extends object> extends TufteChartProps<T> {
  kind: 'line' | 'bar';
}

function TufteChart<T extends object>({
  kind,
  data,
  x,
  y,
  aggregate = 'sum',
  splitBy,
  bucket = 'month',
  fields,
  title,
  description,
  height = 220,
  loading = false,
  valueFormat = formatValue,
  sort = 'value',
  maxSeries = 6,
  maxCategories = 12,
  colorDomain,
  color,
  grid = true,
  tickCount = 4,
  directLabels,
  tableView = true,
  emptyText = 'No data',
  extra,
}: InternalProps<T>) {
  const theme = useTufteTheme(color);
  const [view, setView] = useState<'Chart' | 'Table'>('Chart');

  const rows = data as unknown as Row[];
  const inferred = useMemo(() => fields ?? inferFields(rows), [fields, rows]);
  const defaults = useMemo(() => inferChartKeys(inferred), [inferred]);

  const xKey = x ?? defaults.x;
  const yKey = y ?? (aggregate === 'count' ? undefined : defaults.y);

  const prepared = useMemo(
    () =>
      xKey
        ? prepareChartData(rows, inferred, {
            x: xKey,
            y: yKey,
            aggregate,
            splitBy,
            bucket,
            maxSeries: Math.min(maxSeries, theme.series.length),
            maxCategories,
            sort,
          })
        : null,
    [rows, inferred, xKey, yKey, aggregate, splitBy, bucket, maxSeries, maxCategories, sort, theme],
  );

  const chartRows = prepared?.rows ?? [];
  const series = prepared?.series ?? [];
  const single = series.length === 1;

  // The muted single hue is a claim that there is nothing to tell apart. The
  // moment there is, it becomes a lie, and identity goes back to the validated
  // categorical palette with a legend to name it.
  const categorical = useSeriesColors(single ? [] : series, theme, colorDomain);
  const colorFor = (name: string) => (single ? theme.primary : categorical[name]);

  const labelled = directLabels ?? (kind === 'line' && single);
  // Labelled bars carry their values on the marks; keeping the axis as well
  // would print every number twice.
  const showYAxis = !(kind === 'bar' && labelled && single);

  const tick = { fill: theme.inkMuted, fontSize: theme.fontSize, fontFamily: theme.fontFamily };

  // A plain array, deliberately not a fragment. Recharts finds the axes by
  // walking its own children, and a Fragment sibling of a multi-element array
  // (the one `series.map` produces) hides everything inside it — the grid and
  // the y scale silently disappear the moment a chart has two series. See the
  // note in the module docstring.
  const axes = [
    grid ? <CartesianGrid key="grid" vertical={false} stroke={theme.grid} /> : null,
    <XAxis
      key="x"
      dataKey="__x"
      tick={tick}
      tickLine={false}
      axisLine={false}
      tickMargin={10}
      interval={prepared?.xType === 'date' ? 'preserveStartEnd' : 0}
      minTickGap={12}
    />,
    showYAxis ? (
      <YAxis
        key="y"
        tick={tick}
        tickLine={false}
        axisLine={false}
        width={52}
        tickCount={tickCount}
        tickFormatter={formatCompact}
      />
    ) : null,
  ];

  const tooltip = (
    <Tooltip
      content={<ChartTooltip theme={theme} format={valueFormat} />}
      cursor={
        kind === 'bar'
          ? { fill: theme.ink, fillOpacity: 0.04 }
          : { stroke: theme.axis, strokeWidth: 1 }
      }
    />
  );

  // One series needs no legend — the title names it. Two or more always get
  // one: identity must never rest on color alone.
  const legend = single ? null : (
    <Legend content={<ChartLegend theme={theme} shape={kind === 'line' ? 'line' : 'rect'} />} />
  );

  // Room on the right for a last-point label, and none when there isn't one.
  const margin = { top: 12, right: kind === 'line' && labelled && single ? 56 : 8, bottom: 0, left: 0 };

  function renderChart() {
    if (kind === 'bar') {
      return (
        <BarChart data={chartRows} margin={margin} barGap={2} barCategoryGap="35%">
          {axes}
          {tooltip}
          {legend}
          {series.map((name) => (
            <Bar
              key={name}
              dataKey={name}
              fill={colorFor(name)}
              // Thin bars in a wide band: the air between them is what makes
              // the row of lengths readable as a comparison.
              maxBarSize={18}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            >
              {labelled && single && (
                <LabelList
                  dataKey={name}
                  position="top"
                  offset={8}
                  fill={theme.inkSecondary}
                  fontSize={theme.fontSize}
                  formatter={(value: number) => valueFormat(Number(value))}
                />
              )}
            </Bar>
          ))}
        </BarChart>
      );
    }

    const last = chartRows[chartRows.length - 1];
    // Markers stop being marks and become a texture past a couple of dozen
    // points; the crosshair still gives every point a readout.
    const showDots = chartRows.length <= 24;

    return (
      <LineChart data={chartRows} margin={margin}>
        {axes}
        {tooltip}
        {legend}
        {series.map((name) => (
          <Line
            key={name}
            type="monotone"
            dataKey={name}
            stroke={colorFor(name)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={
              showDots
                ? { r: 3.5, fill: colorFor(name), stroke: theme.surface, strokeWidth: 2 }
                : false
            }
            activeDot={{ r: 5, fill: colorFor(name), stroke: theme.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
        {/* Direct labelling, Tufte's preferred alternative to a legend: the
            series is named by the number sitting at the end of its own line. */}
        {labelled && single && last && (
          <ReferenceDot
            x={last.__x}
            y={Number(last[series[0]])}
            r={0}
            isFront
            label={{
              value: valueFormat(Number(last[series[0]])),
              position: 'right',
              fill: theme.inkSecondary,
              fontSize: theme.fontSize,
            }}
          />
        )}
      </LineChart>
    );
  }

  const hasRows = chartRows.length > 0;

  const notes = [
    prepared?.foldedCategories
      ? `${prepared.foldedCategories} smaller categories folded into “Other”.`
      : null,
    prepared?.foldedSeries
      ? `${prepared.foldedSeries} smaller series folded into “Other”.`
      : null,
  ].filter(Boolean);

  const heading: CSSProperties = {
    fontFamily: theme.fontFamily,
    fontSize: 14,
    fontWeight: 500,
    color: theme.ink,
    margin: 0,
  };

  const sub: CSSProperties = {
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    color: theme.inkMuted,
    margin: 0,
  };

  return (
    // No Card: the plot sits directly on the page surface. A chart that needs
    // a box drawn around it to look finished is usually a chart with too
    // little in it.
    <section style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 4,
        }}
      >
        <div>
          {title && <h3 style={heading}>{title}</h3>}
          {description && <p style={sub}>{description}</p>}
          {notes.map((note) => (
            <p key={String(note)} style={sub}>
              {note}
            </p>
          ))}
        </div>
        {(extra || tableView) && (
          <Space size="small">
            {extra}
            {tableView && (
              <Segmented
                size="small"
                options={['Chart', 'Table']}
                value={view}
                onChange={(value) => setView(value as 'Chart' | 'Table')}
              />
            )}
          </Space>
        )}
      </div>

      <div
        style={{
          height,
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
            {loading ? (
              <Spin />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
            )}
          </div>
        ) : view === 'Chart' ? (
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        ) : (
          <div style={{ height: '100%', overflow: 'auto' }}>
            {/* Every plotted value, readable without a pointer. */}
            <Table
              size="small"
              rowKey="__x"
              dataSource={chartRows}
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
    </section>
  );
}

export function TufteLineChart<T extends object>(props: TufteChartProps<T>) {
  return <TufteChart<T> {...props} kind="line" />;
}

export function TufteBarChart<T extends object>(props: TufteChartProps<T>) {
  return <TufteChart<T> {...props} kind="bar" />;
}
