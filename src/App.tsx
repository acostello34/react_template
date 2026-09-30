import { App as AntApp, ConfigProvider, Layout, Segmented, Space, Switch, theme } from 'antd';
import { useState } from 'react';

import { ApiFeedbackBridge, configureApi } from './api';
import { ProductsDashboard } from './examples/ProductsDashboard';
import { ProductsTable } from './examples/ProductsTable';
import { TufteDashboard } from './examples/TufteDashboard';
// This one is the startup-wiring example, so it ships its own ConfigProvider
// and <App>. That is deliberate — it just means the dark switch above does
// not reach it, and it runs its own configureApi on import (same base URL).
import { Root as UsersExample } from './examples/UsersExample';

/**
 * The app shell the examples were always written against but never had.
 *
 * Two things happen here that have to happen exactly once, at startup:
 * `configureApi` sets the base URL, and `ApiFeedbackBridge` — which must sit
 * *inside* AntD's `<App>` — hands the api layer the context-aware `message`
 * and `notification` instances.
 */

// Relative on purpose: Vite proxies /api to the backend, so the browser makes
// a same-origin request and CORS never applies. The client's own default is
// '/api', which would miss the '/v1' the routers are mounted under.
configureApi({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  getAuthToken: () => localStorage.getItem('access_token'),
});

const EXAMPLES = {
  'Tufte dashboard': <TufteDashboard />,
  'Products dashboard': <ProductsDashboard />,
  'Products table': <ProductsTable />,
  Users: <UsersExample />,
} as const;

type ExampleName = keyof typeof EXAMPLES;

export function App() {
  const [current, setCurrent] = useState<ExampleName>('Tufte dashboard');
  // The charts claim to follow the live AntD algorithm rather than a prop, so
  // the shell gives you a way to actually check that.
  const [dark, setDark] = useState(false);

  return (
    <ConfigProvider
      theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}
    >
      <AntApp>
        <ApiFeedbackBridge>
          <Layout style={{ minHeight: '100vh' }}>
            <Layout.Header
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                paddingInline: 24,
                background: dark ? '#1f1f1f' : '#ffffff',
                borderBottom: `1px solid ${dark ? '#303030' : '#f0f0f0'}`,
              }}
            >
              <Segmented
                value={current}
                options={Object.keys(EXAMPLES) as ExampleName[]}
                onChange={(value) => setCurrent(value as ExampleName)}
              />
              <Space size="small">
                <Switch checked={dark} onChange={setDark} size="small" />
                <span style={{ color: dark ? '#a6a6a6' : '#595959' }}>Dark</span>
              </Space>
            </Layout.Header>

            <Layout.Content style={{ padding: 24 }}>
              {EXAMPLES[current]}
            </Layout.Content>
          </Layout>
        </ApiFeedbackBridge>
      </AntApp>
    </ConfigProvider>
  );
}
