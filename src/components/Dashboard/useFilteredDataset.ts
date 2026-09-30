import { useCallback, useMemo, useState } from 'react';

import { inferFields, type Field, type Row } from '../Chart/fields';
import {
  applyClientFilters,
  buildQueryParams,
  countActiveFilters,
  hasSearchableColumn,
  toFilterFields,
} from '../DataTable/filters';
import type {
  DataTableColumn,
  FilterField,
  FilterValues,
  QueryParams,
} from '../DataTable/types';

/**
 * Owns the filter state for a whole dashboard and produces **one** filtered
 * array.
 *
 * `<DataTable mode="client">` filters internally, which is right for a screen
 * that is only a table — but it makes the filtered rows unreachable, and a KPI
 * tile or chart that re-derives them would be a second implementation of the
 * same predicate, free to disagree with the table under the reader's nose.
 *
 * So the filtering moves up one level. This hook holds the state, runs
 * `applyClientFilters` exactly once per change, and hands the result to every
 * consumer by reference. The table then renders with `mode="external"`,
 * meaning "these rows are already filtered". Nothing downstream can drift,
 * because there is nothing downstream to drift *from*.
 */

export interface UseFilteredDatasetOptions {
  defaultFilters?: FilterValues;
  /**
   * Filter as the user types rather than on Search. Safe here — the work is a
   * synchronous array pass, not a request — but off by default so the hook
   * reads the same as a server-mode table.
   */
  live?: boolean;
}

export interface FilteredDataset<T> {
  /** The filtered array. Every layer of the dashboard reads this reference. */
  rows: T[];
  /** The unfiltered input, for "12 of 240" style denominators. */
  source: T[];

  /** Filter specs lifted off the columns, ready for `<FilterBar>`. */
  filterFields: FilterField[];
  /**
   * Inferred key types, for chart and metric defaults.
   *
   * Read off `source`, not `rows`: a filter that matches nothing must leave
   * the schema intact, or the charts forget their own axes at exactly the
   * moment the reader is looking for an empty state.
   */
  dataFields: Field[];
  searchable: boolean;

  /** What the bar shows. */
  draft: FilterValues;
  /** What `rows` was actually filtered by. */
  applied: FilterValues;
  activeCount: number;

  setDraft: (next: FilterValues) => void;
  search: () => void;
  reset: () => void;

  /**
   * The applied filters as query params. Unused while filtering is local; it
   * is what you hand axios the day the dataset outgrows the browser, and the
   * reason that migration touches this file only.
   */
  params: QueryParams;
}

export function useFilteredDataset<T extends object>(
  data: T[] | null | undefined,
  columns: DataTableColumn<T>[],
  options: UseFilteredDatasetOptions = {},
): FilteredDataset<T> {
  const { defaultFilters, live = false } = options;

  const source = useMemo(() => data ?? [], [data]);
  const filterFields = useMemo(() => toFilterFields(columns), [columns]);
  const searchable = useMemo(() => hasSearchableColumn(columns), [columns]);
  const dataFields = useMemo(() => inferFields(source as Row[]), [source]);

  const [draft, setDraft] = useState<FilterValues>(defaultFilters ?? {});
  const [committed, setCommitted] = useState<FilterValues>(defaultFilters ?? {});
  const applied = live ? draft : committed;

  const search = useCallback(() => setCommitted(draft), [draft]);
  const reset = useCallback(() => {
    setDraft({});
    setCommitted({});
  }, []);

  const rows = useMemo(
    () => applyClientFilters(source, columns, applied),
    [source, columns, applied],
  );

  const params = useMemo(
    () => buildQueryParams(filterFields, applied),
    [filterFields, applied],
  );

  return {
    rows,
    source,
    filterFields,
    dataFields,
    searchable,
    draft,
    applied,
    activeCount: countActiveFilters(applied),
    setDraft,
    search,
    reset,
    params,
  };
}
