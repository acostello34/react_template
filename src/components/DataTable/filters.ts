import dayjs from 'dayjs';

import type {
  ColumnFilter,
  DataTableColumn,
  DateRangeValue,
  FilterField,
  FilterValues,
  NumberRangeValue,
  QueryParams,
  TableQueryState,
} from './types';

/**
 * Pure translation layer: column definitions + control state -> query params,
 * and the same thing again as an in-memory predicate for client mode. No
 * React here, so both directions are trivially testable.
 */

const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';

/** Param names are derived from the column key unless the filter overrides them. */
export function paramNames(key: string, filter: ColumnFilter): string[] {
  switch (filter.kind) {
    case 'numberRange':
      return [filter.minParam ?? `${key}_min`, filter.maxParam ?? `${key}_max`];
    case 'dateRange':
      return [filter.fromParam ?? `${key}_from`, filter.toParam ?? `${key}_to`];
    default:
      return [filter.param ?? key];
  }
}

export function toFilterFields<T>(columns: DataTableColumn<T>[]): FilterField[] {
  return columns
    .filter((column) => column.filter)
    .map((column) => ({
      key: column.key,
      label: column.filter?.label ?? column.title,
      dataIndex: column.dataIndex ?? column.key,
      filter: column.filter as ColumnFilter,
    }));
}

export function hasSearchableColumn<T>(columns: DataTableColumn<T>[]): boolean {
  return columns.some((column) => column.searchable);
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && (value.length === 0 || value.every((item) => item == null)))
  );
}

/** How many controls are actually narrowing the result set. */
export function countActiveFilters(values: FilterValues): number {
  return Object.values(values).filter((value) => !isBlank(value)).length;
}

/**
 * Flattens control state into query params. Blank controls are dropped
 * entirely rather than sent as empty strings, so the server sees an absent
 * optional parameter and the URL stays readable.
 */
export function buildQueryParams(
  fields: FilterField[],
  values: FilterValues,
  state?: Omit<TableQueryState, 'filters'>,
): QueryParams {
  const params: QueryParams = {};

  const search = values.q;
  if (typeof search === 'string' && search.trim()) params.q = search.trim();

  for (const field of fields) {
    const value = values[field.key];
    if (isBlank(value)) continue;

    const { filter } = field;
    const [first, second] = paramNames(field.key, filter);

    switch (filter.kind) {
      case 'text':
        params[first] = String(value).trim();
        break;

      case 'select':
        params[first] = filter.multiple ? (value as string[]) : String(value);
        break;

      case 'boolean':
        params[first] = value === true || value === 'true';
        break;

      case 'numberRange': {
        const [min, max] = value as NumberRangeValue;
        if (min != null) params[first] = min;
        if (max != null) params[second] = max;
        break;
      }

      case 'dateRange': {
        const [from, to] = (value as DateRangeValue) ?? [null, null];
        const format = filter.valueFormat ?? DEFAULT_DATE_FORMAT;
        if (from) params[first] = from.format(format);
        if (to) params[second] = to.format(format);
        break;
      }
    }
  }

  if (state) {
    params.page = state.page;
    params.page_size = state.pageSize;
    if (state.sortBy) {
      params.sort_by = state.sortBy;
      params.sort_order = state.sortOrder ?? 'asc';
    }
  }

  return params;
}

function readCell<T>(row: T, dataIndex: string | string[]): unknown {
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>(
    (value, segment) =>
      value == null ? undefined : (value as Record<string, unknown>)[segment],
    row,
  );
}

function matchesText(cell: unknown, needle: string, match: string): boolean {
  const haystack = String(cell ?? '').toLowerCase();
  const term = needle.trim().toLowerCase();
  if (match === 'equals') return haystack === term;
  if (match === 'startsWith') return haystack.startsWith(term);
  return haystack.includes(term);
}

/**
 * Client-mode filtering. Mirrors the server's semantics — case-insensitive
 * substring on text, `in` on multi-select, inclusive bounds on ranges — so a
 * table reads the same whichever mode it runs in.
 */
export function applyClientFilters<T>(
  rows: T[],
  columns: DataTableColumn<T>[],
  values: FilterValues,
): T[] {
  const fields = toFilterFields(columns);
  const searchable = columns.filter((column) => column.searchable);
  const search = typeof values.q === 'string' ? values.q.trim().toLowerCase() : '';

  return rows.filter((row) => {
    if (search) {
      const hit = searchable.some((column) =>
        String(readCell(row, column.dataIndex ?? column.key) ?? '')
          .toLowerCase()
          .includes(search),
      );
      if (!hit) return false;
    }

    return fields.every((field) => {
      const value = values[field.key];
      if (isBlank(value)) return true;

      const cell = readCell(row, field.dataIndex);
      const { filter } = field;

      switch (filter.kind) {
        case 'text':
          return matchesText(cell, String(value), filter.match ?? 'contains');

        case 'select': {
          const selected = Array.isArray(value) ? value : [value];
          return selected.map(String).includes(String(cell));
        }

        case 'boolean':
          return Boolean(cell) === (value === true || value === 'true');

        case 'numberRange': {
          const [min, max] = value as NumberRangeValue;
          const numeric = Number(cell);
          if (Number.isNaN(numeric)) return false;
          if (min != null && numeric < min) return false;
          if (max != null && numeric > max) return false;
          return true;
        }

        case 'dateRange': {
          const [from, to] = (value as DateRangeValue) ?? [null, null];
          // Parse the cell with dayjs, not `new Date`: a bare 'YYYY-MM-DD'
          // string is UTC midnight to the Date constructor but local midnight
          // to the picker, which shifts same-day matches by a day.
          const cellDate = dayjs(cell as string | number | Date);
          if (!cellDate.isValid()) return false;
          // Day boundaries, so a same-day `to` still matches.
          if (from && cellDate.isBefore(from.startOf('day'))) return false;
          if (to && cellDate.isAfter(to.endOf('day'))) return false;
          return true;
        }

        default:
          return true;
      }
    });
  });
}
