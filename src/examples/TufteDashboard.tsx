import { Tag } from 'antd';
import { useMemo } from 'react';

import { api, useApi } from '../api';
import { currencyFormatter } from '../components/Chart';
import {
  DashboardLayout,
  MetricGrid,
  TufteBarChart,
  TufteLineChart,
  useFilteredDataset,
  type MetricSpec,
} from '../components/Dashboard';
import { DataTable, FilterBar } from '../components/DataTable';
import type { DataTableColumn, SelectOption } from '../components/DataTable';

/**
 * A dashboard with one filtered array behind every layer.
 *
 * The whole slice is fetched once and filtered in the browser, so the tiles,
 * the charts and the table are three renderings of a single `T[]` — change a
 * filter and all three re-render from the same reference in the same commit.
 * There is no path by which they can show different numbers, because there is
 * no second copy of the data for them to disagree about.
 */

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  status: 'active' | 'draft' | 'discontinued';
  supplier: string;
  price: number;
  stock: number;
  rating: number;
  in_stock: boolean;
  created_at: string;
}

const money = currencyFormatter('USD');

/** Fixed up front, so filtering a status away never repaints the others. */
const STATUS_DOMAIN = ['active', 'draft', 'discontinued'];

const STATUS_COLORS: Record<Product['status'], string> = {
  active: 'green',
  draft: 'gold',
  discontinued: 'default',
};

/** Distinct values of a key, as select options. */
function optionsFor(rows: Product[], key: keyof Product): SelectOption[] {
  return [...new Set(rows.map((row) => String(row[key])))]
    .sort()
    .map((value) => ({ label: value, value }));
}

export function TufteDashboard() {
  // One request for the whole slice. The endpoint caps a page at 200 rows, so
  // the tiles below say what they are counting rather than implying 240.
  const products = useApi(
    ({ signal }) =>
      api.get<Product[]>('/products', { params: { page: 1, page_size: 200 }, signal }),
    { immediate: true },
  );

  const loaded = useMemo(() => products.data ?? [], [products.data]);

  const columns = useMemo<DataTableColumn<Product>[]>(
    () => [
      {
        key: 'name',
        title: 'Product',
        searchable: true,
        sorter: (a, b) => a.name.localeCompare(b.name),
        filter: { kind: 'text', placeholder: 'Name contains…' },
      },
      { key: 'sku', title: 'SKU', width: 120, searchable: true },
      {
        key: 'category',
        title: 'Category',
        filter: {
          kind: 'select',
          multiple: true,
          options: optionsFor(loaded, 'category'),
          placeholder: 'Any category',
        },
      },
      {
        key: 'status',
        title: 'Status',
        render: (_, row) => <Tag color={STATUS_COLORS[row.status]}>{row.status}</Tag>,
        filter: {
          kind: 'select',
          options: STATUS_DOMAIN.map((value) => ({ label: value, value })),
          placeholder: 'Any status',
        },
      },
      {
        key: 'supplier',
        title: 'Supplier',
        filter: { kind: 'select', multiple: true, options: optionsFor(loaded, 'supplier') },
      },
      {
        key: 'price',
        title: 'Price',
        align: 'right',
        sorter: (a, b) => a.price - b.price,
        render: (value: number) => money(value),
        filter: { kind: 'numberRange', min: 0, step: 10, precision: 2 },
      },
      {
        key: 'stock',
        title: 'Stock',
        align: 'right',
        sorter: (a, b) => a.stock - b.stock,
        filter: { kind: 'numberRange', min: 0, step: 10 },
      },
      {
        key: 'created_at',
        title: 'Added',
        render: (value: string) => value.slice(0, 10),
        sorter: (a, b) => a.created_at.localeCompare(b.created_at),
        filter: { kind: 'dateRange' },
      },
    ],
    [loaded],
  );

  // The single source of truth. Everything below reads `dataset.rows`.
  const dataset = useFilteredDataset(loaded, columns);
  const { rows } = dataset;

  const metrics = useMemo<MetricSpec<Product>[]>(
    () => [
      {
        key: 'count',
        label: 'Products',
        aggregate: 'count',
        caption: (value) =>
          value === dataset.source.length
            ? `all ${dataset.source.length} loaded`
            : `of ${dataset.source.length} loaded`,
      },
      {
        key: 'inventory',
        label: 'Inventory value',
        aggregate: 'sum',
        // A derived measure: price × stock exists in no column.
        value: (row) => row.price * row.stock,
        format: money,
      },
      { key: 'price', label: 'Average price', aggregate: 'mean', field: 'price', format: money },
      {
        key: 'oos',
        label: 'Out of stock',
        aggregate: 'count',
        where: (row) => !row.in_stock,
        caption: (value, scoped) =>
          scoped.length ? `${Math.round((value / scoped.length) * 100)}% of selection` : '—',
      },
    ],
    [dataset.source.length],
  );

  return (
    <DashboardLayout
      title="Catalogue"
      description="Filters scope every figure on this page."
      filters={
        <FilterBar
          fields={dataset.filterFields}
          values={dataset.draft}
          onChange={dataset.setDraft}
          onSearch={dataset.search}
          onReset={dataset.reset}
          searchable={dataset.searchable}
          searchPlaceholder="Search name or SKU…"
          loading={products.loading}
        />
      }
      metrics={<MetricGrid data={rows} metrics={metrics} loading={products.loading} />}
      charts={[
        <TufteBarChart<Product>
          key="stock"
          title="Stock on hand by category"
          data={rows}
          fields={dataset.dataFields}
          loading={products.loading}
          x="category"
          y="stock"
          aggregate="sum"
        />,
        <TufteLineChart<Product>
          key="added"
          title="Products added per month"
          data={rows}
          fields={dataset.dataFields}
          loading={products.loading}
          x="created_at"
          bucket="month"
          aggregate="count"
          sort="none"
        />,
      ]}
      wideCharts={[
        // Direct labels instead of a y axis: with one number per bar there is
        // nothing left for the axis to tell you.
        <TufteBarChart<Product>
          key="price"
          title="Average price by category"
          description="Labelled directly; the y axis would only repeat these."
          data={rows}
          fields={dataset.dataFields}
          loading={products.loading}
          x="category"
          y="price"
          aggregate="mean"
          valueFormat={money}
          directLabels
          grid={false}
          height={200}
        />,
      ]}
      table={
        <DataTable<Product>
          columns={columns}
          data={rows}
          rowKey="id"
          // The rows arrived filtered. The table sorts and paginates them and
          // renders no bar of its own.
          mode="external"
          loading={products.loading}
          defaultPageSize={10}
        />
      }
    />
  );
}
