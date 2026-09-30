import { Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import type { ColumnsType, SorterResult, TablePaginationConfig } from 'antd/es/table/interface';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { FilterBar } from './FilterBar';
import { applyClientFilters, buildQueryParams, hasSearchableColumn, toFilterFields } from './filters';
import type {
  DataTableColumn,
  FilterValues,
  QueryParams,
  SortOrder,
  TableQueryState,
} from './types';

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: TableProps<T>['rowKey'];

  /**
   * 'client' filters, sorts and paginates `data` in the browser.
   * 'server' leaves `data` untouched and reports every change through
   * `onQueryChange` instead.
   * 'external' means something above the table already filtered these rows —
   * `useFilteredDataset` on a dashboard, typically. The table renders no
   * filter bar and re-filters nothing; it still sorts and paginates locally.
   */
  mode?: 'client' | 'server' | 'external';
  loading?: boolean;

  title?: ReactNode;
  /** Page-level buttons for the right of the action bar. */
  actions?: ReactNode;
  searchPlaceholder?: string;

  defaultFilters?: FilterValues;
  defaultPageSize?: number;
  /** Controls shown before the "More filters" toggle. Default 3. */
  collapsedFilterCount?: number;

  /** Server mode: the row count behind the current query. */
  total?: number;
  /**
   * Server mode: fired on mount and on every search, reset, page or sort
   * change. `params` is ready to pass straight to axios.
   */
  onQueryChange?: (params: QueryParams, state: TableQueryState) => void;

  /** Anything else the underlying AntD Table should receive. */
  tableProps?: Omit<
    TableProps<T>,
    'columns' | 'dataSource' | 'rowKey' | 'loading' | 'pagination' | 'onChange'
  >;
}

/**
 * A Table plus a filter bar, both driven by one column definition.
 *
 * Generic over the row type: `columns` is checked against `T`, and the
 * component is used as `<DataTable<Product> … />`.
 */
export function DataTable<T extends object>({
  columns,
  data,
  rowKey,
  mode = 'client',
  loading = false,
  title,
  actions,
  searchPlaceholder,
  defaultFilters,
  defaultPageSize = 10,
  collapsedFilterCount = 3,
  total,
  onQueryChange,
  tableProps,
}: DataTableProps<T>) {
  const fields = useMemo(() => toFilterFields(columns), [columns]);
  const searchable = useMemo(() => hasSearchableColumn(columns), [columns]);

  // `draft` is what the bar shows; `applied` is what the table (or server)
  // actually ran. Splitting them is what makes Search/Reset meaningful and
  // keeps typing in a box from firing a request per keystroke.
  const [draft, setDraft] = useState<FilterValues>(defaultFilters ?? {});
  const [applied, setApplied] = useState<FilterValues>(defaultFilters ?? {});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortOrder, setSortOrder] = useState<SortOrder | undefined>();

  const handleSearch = useCallback(() => {
    setApplied(draft);
    setPage(1);
  }, [draft]);

  const handleReset = useCallback(() => {
    setDraft({});
    setApplied({});
    setPage(1);
    setSortBy(undefined);
    setSortOrder(undefined);
  }, []);

  const params = useMemo(
    () => buildQueryParams(fields, applied, { page, pageSize, sortBy, sortOrder }),
    [fields, applied, page, pageSize, sortBy, sortOrder],
  );

  // Kept in a ref so an inline arrow function from the parent doesn't count as
  // a query change and re-fire the request on every render.
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    if (mode !== 'server') return;
    onQueryChangeRef.current?.(params, { page, pageSize, sortBy, sortOrder, filters: applied });
    // `params` is fully described by its serialization; comparing the string
    // avoids re-firing on a new object with identical contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paramsKey]);

  const rows = useMemo(
    () => (mode === 'client' ? applyClientFilters(data, columns, applied) : data),
    [mode, data, columns, applied],
  );

  const tableColumns = useMemo<ColumnsType<T>>(
    () =>
      columns
        .filter((column) => !column.hidden)
        // Strip the props AntD doesn't know about and default dataIndex to key.
        .map(({ filter: _filter, searchable: _searchable, hidden: _hidden, ...rest }) => ({
          ...rest,
          dataIndex: rest.dataIndex ?? rest.key,
        })),
    [columns],
  );

  const handleTableChange: TableProps<T>['onChange'] = (pagination, _filters, sorter) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? pageSize);

    // Server mode owns sorting; in client mode AntD already sorted the rows.
    if (mode === 'server') {
      const next = Array.isArray(sorter) ? sorter[0] : (sorter as SorterResult<T>);
      const key = next?.columnKey ? String(next.columnKey) : undefined;
      setSortBy(next?.order ? key : undefined);
      setSortOrder(next?.order === 'descend' ? 'desc' : next?.order ? 'asc' : undefined);
    }
  };

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total: mode === 'server' ? (total ?? rows.length) : rows.length,
    showSizeChanger: true,
    showTotal: (count, range) => `${range[0]}–${range[1]} of ${count}`,
  };

  return (
    <div>
      {title && (
        <Typography.Title level={4} style={{ marginBottom: 16 }}>
          {title}
        </Typography.Title>
      )}

      {/* In 'external' mode the filter controls live with the dashboard that
          owns the filtered array; a second bar here would be a second source
          of truth. Page-level actions still belong to the table. */}
      {mode === 'external' ? (
        actions && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            {actions}
          </div>
        )
      ) : (
        <FilterBar
          fields={fields}
          values={draft}
          onChange={setDraft}
          onSearch={handleSearch}
          onReset={handleReset}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          loading={loading}
          actions={actions}
          collapsedCount={collapsedFilterCount}
        />
      )}

      <Table<T>
        {...tableProps}
        columns={tableColumns}
        dataSource={rows}
        rowKey={rowKey}
        loading={loading}
        pagination={pagination}
        onChange={handleTableChange}
      />
    </div>
  );
}
