import { useMemo, useRef } from 'react';
import { theme } from 'antd';

/**
 * Chart color, split the way the dataviz method wants it:
 *
 *  - series colors come from a fixed, validated categorical palette and are
 *    assigned in slot order, never cycled and never generated;
 *  - chrome (surface, ink, grid, axis) comes from AntD's design tokens, so a
 *    chart inherits whatever theme the app is running.
 *
 * The eight slots below were validated against AntD's own container surfaces
 * (#ffffff light, #141414 dark): lightness band, chroma floor, adjacent CVD
 * separation (worst ΔE 9.1 light / 8.4 dark, target ≥8) and normal-vision
 * separation (19.6 / 19.3, floor ≥15) all pass. Light-mode aqua, yellow and
 * magenta sit below 3:1 against white, which obligates "relief" — that is why
 * every chart here ships a table view.
 *
 * Swapping in brand hues means re-running the validator, not eyeballing.
 */

export const SERIES_LIGHT = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/** The folded tail ("Other") is deliberately not a ninth hue. */
export const OTHER_COLOR = '#898781';
export const OTHER_LABEL = 'Other';

export interface ChartTheme {
  dark: boolean;
  /** Also the color of the 2px gaps and rings that separate marks. */
  surface: string;
  series: readonly string[];
  other: string;
  grid: string;
  axis: string;
  ink: string;
  inkSecondary: string;
  inkMuted: string;
  fontFamily: string;
  fontSize: number;
  borderRadius: number;
  boxShadow: string;
  border: string;
}

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a hex or rgb() color; NaN if unparseable. */
export function luminance(color: string): number {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let rgb: number[] | null = null;

  if (hex) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((character) => character + character)
            .join('')
        : digits;
    rgb = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
  } else {
    const parts = color.match(/rgba?\(([^)]+)\)/i);
    if (parts) rgb = parts[1].split(',').slice(0, 3).map((part) => Number(part.trim()));
  }

  if (!rgb || rgb.some(Number.isNaN)) return Number.NaN;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Reads the chart's palette off the live AntD theme.
 *
 * Dark mode is detected from the rendered surface rather than from a prop, so
 * the chart follows `ConfigProvider`'s algorithm — including a per-section
 * dark theme — without the call site passing anything.
 */
export function useChartTheme(): ChartTheme {
  const { token } = theme.useToken();
  const surfaceLuminance = luminance(token.colorBgContainer);
  const dark = Number.isNaN(surfaceLuminance) ? false : surfaceLuminance < 0.5;

  return {
    dark,
    surface: token.colorBgContainer,
    series: dark ? SERIES_DARK : SERIES_LIGHT,
    other: OTHER_COLOR,
    // One step off the surface, hairline and solid — AntD's split/border
    // tokens are exactly that, so the grid tracks the app's theme.
    grid: token.colorSplit,
    axis: token.colorBorder,
    ink: token.colorText,
    inkSecondary: token.colorTextSecondary,
    inkMuted: token.colorTextTertiary,
    fontFamily: token.fontFamily,
    fontSize: token.fontSizeSM,
    borderRadius: token.borderRadiusLG,
    boxShadow: token.boxShadowSecondary,
    border: token.colorBorderSecondary,
  };
}

/**
 * Stable color per series *name*.
 *
 * Slots are handed out in first-seen order and remembered, so filtering a
 * series away doesn't repaint the ones that remain — a reader who learned
 * "draft is orange" keeps that. Pass `colorDomain` to fix the assignment up
 * front instead of letting the first payload decide.
 */
export function useSeriesColors(
  series: string[],
  theme: ChartTheme,
  domain?: string[],
): Record<string, string> {
  const slots = useRef(new Map<string, number>());
  const key = `${domain?.join('|') ?? ''}::${series.join('|')}`;

  return useMemo(() => {
    const assigned = slots.current;
    for (const name of [...(domain ?? []), ...series]) {
      // "Other" is a remainder, not an entity: it wears the de-emphasis gray
      // rather than claiming a categorical slot.
      if (name === OTHER_LABEL || assigned.has(name)) continue;
      assigned.set(name, assigned.size);
    }

    return Object.fromEntries(
      series.map((name) => [
        name,
        name === OTHER_LABEL
          ? theme.other
          : theme.series[Math.min(assigned.get(name) ?? 0, theme.series.length - 1)],
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme]);
}
