import type { ColumnType } from 'antd/es/table/interface';
import type { Dayjs } from 'dayjs';
import type { ReactNode } from 'react';

/**
 * Column definitions carry their own filter spec, so a screen declares its
 * table once and the action bar, the query string and (in client mode) the
 * filtering itself all follow from that single description.
 */

export type FilterKind = 'text' | 'select' | 'numberRange' | 'dateRange' | 'boolean';

export interface SelectOption {
  label: ReactNode;
  value: string;
}

interface FilterBase {
  /** Bar label. Defaults to the column's `title`. */
  label?: ReactNode;
  placeholder?: string;
  /** Grid width of the control, in 24ths. Default 6 (4 per row on desktop). */
  span?: number;
}

export interface TextFilter extends FilterBase {
  kind: 'text';
  /** Query param name. Default: the column key. */
  param?: string;
  /** Client mode only; the server decides its own matching. Default 'contains'. */
  match?: 'contains' | 'startsWith' | 'equals';
}

export interface SelectFilter extends FilterBase {
  kind: 'select';
  options: SelectOption[];
  /** Emits a repeated param (`status=a&status=b`), which FastAPI reads as a list. */
  multiple?: boolean;
  param?: string;
}

export interface NumberRangeFilter extends FilterBase {
  kind: 'numberRange';
  /** Default: `<key>_min` / `<key>_max`. */
  minParam?: string;
  maxParam?: string;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
}

export interface DateRangeFilter extends FilterBase {
  kind: 'dateRange';
  /** Default: `<key>_from` / `<key>_to`. */
  fromParam?: string;
  toParam?: string;
  /** Wire format. Default 'YYYY-MM-DD'. */
  valueFormat?: string;
}

export interface BooleanFilter extends FilterBase {
  kind: 'boolean';
  param?: string;
  trueLabel?: string;
  falseLabel?: string;
}

export type ColumnFilter =
  | TextFilter
  | SelectFilter
  | NumberRangeFilter
  | DateRangeFilter
  | BooleanFilter;

export interface DataTableColumn<T> extends Omit<ColumnType<T>, 'key' | 'dataIndex'> {
  /** Identifies the column and seeds every default: dataIndex, param names, sort field. */
  key: string;
  title: ReactNode;
  /** Defaults to `key`. An array reads a nested path. */
  dataIndex?: string | string[];
  /** Adding this puts a control for the column in the action bar. */
  filter?: ColumnFilter;
  /** Include this column in the single-box search (`q` param). */
  searchable?: boolean;
  /** Keep the definition, leave it out of the rendered table. */
  hidden?: boolean;
}

/** A column's filter, lifted out for the bar to render. */
export interface FilterField {
  key: string;
  label: ReactNode;
  dataIndex: string | string[];
  filter: ColumnFilter;
}

/** Raw control state, keyed by column key. Shapes vary by filter kind. */
export type FilterValues = Record<string, unknown>;

/** Flat, serializable — ready to hand to axios as `params`. */
export type QueryParams = Record<string, string | number | boolean | string[]>;

export type SortOrder = 'asc' | 'desc';

export interface TableQueryState {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  filters: FilterValues;
}

/** The `[start, end]` tuple AntD's RangePicker produces. */
export type DateRangeValue = [Dayjs | null, Dayjs | null] | null;
/** The `[min, max]` tuple the number-range control produces. */
export type NumberRangeValue = [number | null, number | null];
