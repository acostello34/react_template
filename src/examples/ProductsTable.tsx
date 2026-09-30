import { Button, Tag } from 'antd';
import { useMemo } from 'react';

import { api, useApi } from '../api';
import { DataTable, type DataTableColumn, type QueryParams, type SelectOption } from '../components/DataTable';

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  status: 'active' | 'draft' | 'discontinued';
  price: number;
  stock: number;
  rating: number;
  in_stock: boolean;
  created_at: string;
}

interface FilterOptions {
  categories: SelectOption[];
  statuses: SelectOption[];
  price: { min: number; max: number };
}

const STATUS_COLORS: Record<Product['status'], string> = {
  active: 'green',
  draft: 'gold',
  discontinued: 'default',
};

export function ProductsTable() {
  // Select options come from the server, so adding a category needs no deploy.
  const options = useApi(({ signal }) => api.get<FilterOptions>('/products/filters', { signal }), {
    immediate: true,
    showError: false,
  });

  const products = useApi(
    ({ signal }, params: QueryParams) => api.get<Product[]>('/products', { params, signal }),
  );

  const columns = useMemo<DataTableColumn<Product>[]>(
    () => [
      {
        key: 'name',
        title: 'Product',
        searchable: true,
        sorter: true,
        filter: { kind: 'text', placeholder: 'Name contains…' },
      },
      { key: 'sku', title: 'SKU', searchable: true, width: 120 },
      {
        key: 'category',
        title: 'Category',
        filter: {
          kind: 'select',
          multiple: true,
          options: options.data?.categories ?? [],
          placeholder: 'Any category',
        },
      },
      {
        key: 'status',
        title: 'Status',
        render: (_, row) => <Tag color={STATUS_COLORS[row.status]}>{row.status}</Tag>,
        filter: { kind: 'select', options: options.data?.statuses ?? [] },
      },
      {
        key: 'price',
        title: 'Price',
        align: 'right',
        sorter: true,
        render: (value: number) => `$${value.toFixed(2)}`,
        filter: {
          kind: 'numberRange',
          min: options.data?.price.min ?? 0,
          max: options.data?.price.max,
          step: 5,
          precision: 2,
        },
      },
      {
        key: 'stock',
        title: 'Stock',
        align: 'right',
        sorter: true,
        filter: { kind: 'numberRange', min: 0, step: 10 },
      },
      {
        key: 'in_stock',
        title: 'Available',
        render: (value: boolean) => (value ? 'Yes' : 'No'),
        filter: { kind: 'boolean', trueLabel: 'In stock', falseLabel: 'Out of stock' },
      },
      {
        key: 'created_at',
        title: 'Added',
        sorter: true,
        filter: { kind: 'dateRange' },
      },
    ],
    [options.data],
  );

  return (
    <DataTable<Product>
      title="Products"
      mode="server"
      rowKey="id"
      columns={columns}
      data={products.data ?? []}
      total={products.metadata?.pagination?.total_items}
      loading={products.loading}
      searchPlaceholder="Search name or SKU…"
      // Fires on mount and on every search, reset, page or sort change — so
      // the hook itself must NOT be `immediate`, or the first load runs twice.
      onQueryChange={(params) => void products.run(params)}
      actions={<Button type="primary">New product</Button>}
    />
  );
}
