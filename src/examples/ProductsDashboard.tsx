import { Card, Col, Row, Statistic } from 'antd';
import { useMemo, useState } from 'react';

import { api, useApi } from '../api';
import { DataChart, currencyFormatter } from '../components/Chart';
import { FilterBar, buildQueryParams, toFilterFields } from '../components/DataTable';
import type { DataTableColumn, FilterValues } from '../components/DataTable';

interface Product {
  id: string;
  category: string;
  status: string;
  supplier: string;
  price: number;
  stock: number;
  rating: number;
  in_stock: boolean;
  created_at: string;
}

/** The same column definitions that drive the table drive the filter row. */
const FILTERS: DataTableColumn<Product>[] = [
  { key: 'category', title: 'Category', filter: { kind: 'select', multiple: true, options: [] } },
  {
    key: 'status',
    title: 'Status',
    filter: {
      kind: 'select',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Draft', value: 'draft' },
        { label: 'Discontinued', value: 'discontinued' },
      ],
    },
  },
  { key: 'price', title: 'Price', filter: { kind: 'numberRange', min: 0, step: 10 } },
  { key: 'created_at', title: 'Added', filter: { kind: 'dateRange' } },
];

/** Fixed up front, so filtering a status away never repaints the others. */
const STATUS_DOMAIN = ['active', 'draft', 'discontinued'];

const money = currencyFormatter('USD');

export function ProductsDashboard() {
  const fields = useMemo(() => toFilterFields(FILTERS), []);
  const [draft, setDraft] = useState<FilterValues>({});

  const products = useApi(
    ({ signal }, filters: FilterValues) =>
      api.get<Product[]>('/products', {
        // Charts summarize the whole slice, not one screen of it. The chart
        // states its own coverage from `metadata.pagination` either way.
        params: { ...buildQueryParams(fields, filters), page: 1, page_size: 200 },
        signal,
      }),
    { immediate: true, defaultArgs: [{}] },
  );

  const rows = products.data ?? [];
  const averagePrice = rows.length
    ? rows.reduce((total, row) => total + row.price, 0) / rows.length
    : 0;

  return (
    <div>
      {/* One filter row, above everything it scopes — every tile and chart
          below re-renders against the same slice, so the numbers agree. */}
      <FilterBar
        fields={fields}
        values={draft}
        onChange={setDraft}
        onSearch={() => void products.run(draft)}
        onReset={() => {
          setDraft({});
          void products.run({});
        }}
        loading={products.loading}
      />

      {/* Headline numbers are stat tiles, not one-bar charts. */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic
              title="Products"
              value={products.metadata?.pagination?.total_items ?? rows.length}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="Average price" value={money(averagePrice)} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="Out of stock" value={rows.filter((row) => !row.in_stock).length} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          {/* One series: one color for every bar, and no legend — the title
              already says what is plotted. */}
          <DataChart<Product>
            title="Stock on hand by category"
            data={products.data}
            loading={products.loading}
            kind="bar"
            x="category"
            y="stock"
            aggregate="sum"
          />
        </Col>

        <Col xs={24} lg={12}>
          <DataChart<Product>
            title="Catalogue by category and status"
            description="Part-to-whole: how each category splits across statuses."
            data={products.data}
            loading={products.loading}
            kind="stackedBar"
            x="category"
            aggregate="count"
            splitBy="status"
            colorDomain={STATUS_DOMAIN}
          />
        </Col>

        <Col xs={24}>
          <DataChart<Product>
            title="Products added per month"
            data={products.data}
            loading={products.loading}
            kind="line"
            x="created_at"
            bucket="month"
            aggregate="count"
            sort="none"
          />
        </Col>

        <Col xs={24} lg={12}>
          {/* Average price is a different scale from stock — a separate chart,
              never a second y-axis on the one above. */}
          <DataChart<Product>
            title="Average price by category"
            data={products.data}
            loading={products.loading}
            kind="bar"
            x="category"
            y="price"
            aggregate="mean"
            valueFormat={money}
          />
        </Col>
      </Row>
    </div>
  );
}
