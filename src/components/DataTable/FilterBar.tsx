import { Button, Col, DatePicker, Input, InputNumber, Row, Select, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { countActiveFilters } from './filters';
import type {
  ColumnFilter,
  DateRangeValue,
  FilterField,
  FilterValues,
  NumberRangeValue,
} from './types';

const { RangePicker } = DatePicker;

export interface FilterBarProps {
  fields: FilterField[];
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  onSearch: () => void;
  onReset: () => void;
  /** Show the single-box search that spans every `searchable` column. */
  searchable?: boolean;
  searchPlaceholder?: string;
  loading?: boolean;
  /** Page-level buttons — "New", "Export", … — pinned to the right. */
  actions?: ReactNode;
  /** Controls shown before the "More filters" toggle. Default 3. */
  collapsedCount?: number;
}

/**
 * The action bar. Purely presentational: it owns no filter state, only the
 * expand/collapse of its own overflow row, so it can be dropped above
 * something other than a Table if needed.
 */
export function FilterBar({
  fields,
  values,
  onChange,
  onSearch,
  onReset,
  searchable = false,
  searchPlaceholder = 'Search…',
  loading = false,
  actions,
  collapsedCount = 3,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  const collapsible = fields.length > collapsedCount;
  const visible = collapsible && !expanded ? fields.slice(0, collapsedCount) : fields;
  const hiddenActive = countActiveFilters(
    Object.fromEntries(
      fields.slice(collapsedCount).map((field) => [field.key, values[field.key]]),
    ),
  );

  const setValue = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div style={{ marginBottom: 16 }}>
      <Row justify="space-between" align="middle" gutter={[16, 16]} wrap>
        <Col xs={24} md={10}>
          {searchable && (
            <Input.Search
              allowClear
              value={(values.q as string) ?? ''}
              placeholder={searchPlaceholder}
              onChange={(event) => setValue('q', event.target.value)}
              onSearch={onSearch}
              loading={loading}
            />
          )}
        </Col>
        {actions && (
          <Col xs={24} md={14} style={{ textAlign: 'right' }}>
            <Space wrap>{actions}</Space>
          </Col>
        )}
      </Row>

      {fields.length > 0 && (
        <Row gutter={[16, 12]} align="bottom" style={{ marginTop: 16 }}>
          {visible.map((field) => (
            <Col key={field.key} xs={24} sm={12} md={8} lg={field.filter.span ?? 6}>
              <label
                htmlFor={`filter-${field.key}`}
                style={{ display: 'block', marginBottom: 4 }}
              >
                <Typography.Text type="secondary">{field.label}</Typography.Text>
              </label>
              <FilterControl
                field={field}
                value={values[field.key]}
                onChange={(value) => setValue(field.key, value)}
                onSubmit={onSearch}
              />
            </Col>
          ))}

          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space>
              {collapsible && (
                <Button type="link" onClick={() => setExpanded((previous) => !previous)}>
                  {expanded
                    ? 'Fewer filters'
                    : `More filters${hiddenActive ? ` (${hiddenActive} set)` : ''}`}
                </Button>
              )}
              <Button onClick={onReset}>Reset</Button>
              <Button type="primary" loading={loading} onClick={onSearch}>
                Search
              </Button>
            </Space>
          </Col>
        </Row>
      )}
    </div>
  );
}

interface ControlProps {
  field: FilterField;
  value: unknown;
  onChange: (value: unknown) => void;
  onSubmit: () => void;
}

/** One control per filter kind. Add a kind here and in `filters.ts`, nowhere else. */
function FilterControl({ field, value, onChange, onSubmit }: ControlProps) {
  const filter: ColumnFilter = field.filter;
  const id = `filter-${field.key}`;
  const full = { width: '100%' } as const;

  switch (filter.kind) {
    case 'text':
      return (
        <Input
          id={id}
          allowClear
          value={(value as string) ?? ''}
          placeholder={filter.placeholder}
          onChange={(event) => onChange(event.target.value)}
          onPressEnter={onSubmit}
        />
      );

    case 'select':
      return (
        <Select
          id={id}
          allowClear
          showSearch
          optionFilterProp="label"
          maxTagCount="responsive"
          style={full}
          mode={filter.multiple ? 'multiple' : undefined}
          placeholder={filter.placeholder ?? 'Any'}
          value={(value as string | string[] | undefined) ?? undefined}
          options={filter.options}
          onChange={(next) => onChange(next)}
        />
      );

    case 'boolean':
      return (
        <Select
          id={id}
          allowClear
          style={full}
          placeholder={filter.placeholder ?? 'Any'}
          value={(value as boolean | undefined) ?? undefined}
          onChange={(next) => onChange(next)}
          options={[
            { label: filter.trueLabel ?? 'Yes', value: true },
            { label: filter.falseLabel ?? 'No', value: false },
          ]}
        />
      );

    case 'numberRange': {
      const [min, max] = (value as NumberRangeValue) ?? [null, null];
      return (
        <Space.Compact style={full}>
          <InputNumber
            id={id}
            style={{ width: '50%' }}
            placeholder="Min"
            min={filter.min}
            max={filter.max}
            step={filter.step}
            precision={filter.precision}
            value={min}
            onChange={(next) => onChange([next ?? null, max])}
            onPressEnter={onSubmit}
          />
          <InputNumber
            style={{ width: '50%' }}
            placeholder="Max"
            min={filter.min}
            max={filter.max}
            step={filter.step}
            precision={filter.precision}
            value={max}
            onChange={(next) => onChange([min, next ?? null])}
            onPressEnter={onSubmit}
          />
        </Space.Compact>
      );
    }

    case 'dateRange':
      return (
        <RangePicker
          id={id}
          style={full}
          allowEmpty={[true, true]}
          value={(value as DateRangeValue) ?? undefined}
          onChange={(range) => onChange(range as DateRangeValue)}
        />
      );

    default:
      return null;
  }
}
