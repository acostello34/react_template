import { useChartTheme, type ChartTheme } from '../Chart/palette';

/**
 * The Tufte layer's one departure from the categorical palette.
 *
 * Tufte's rule is that ink should be data; a hue that varies across marks is
 * ink doing a *labelling* job, and on a single-measure chart there is nothing
 * to label — the title already says what is plotted. So these charts spend one
 * muted hue on the whole series and keep every other pixel recessive.
 *
 * Both steps were run through the dataviz validator against AntD's container
 * surfaces (#ffffff light, #141414 dark) and pass all six checks — lightness
 * band, chroma floor, and >=3:1 contrast against the surface. "Muted" here is
 * low chroma, not low contrast: drop the chroma any further and the validator
 * fails it for reading as gray. Re-run the validator if you swap these.
 *
 * The moment a chart has two or more series this hue is abandoned rather than
 * reused: identity needs the validated categorical palette and a legend.
 */

export const MUTED_PRIMARY_LIGHT = '#3d6ea8';
export const MUTED_PRIMARY_DARK = '#5a8fcc';

export interface TufteTheme extends ChartTheme {
  /** The single data-ink color for one-series charts. */
  primary: string;
}

export function useTufteTheme(primary?: string): TufteTheme {
  const base = useChartTheme();
  return {
    ...base,
    primary: primary ?? (base.dark ? MUTED_PRIMARY_DARK : MUTED_PRIMARY_LIGHT),
  };
}
