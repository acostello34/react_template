import { App, Button, ConfigProvider, Form, Input, Spin, Table } from 'antd';
import { useEffect } from 'react';

import {
  ApiFeedbackBridge,
  api,
  configureApi,
  useApi,
  useGlobalLoading,
  type ApiResponse,
} from '../api';

/* ------------------------------------------------------------------ *
 * 1. Startup wiring — once, at the root
 * ------------------------------------------------------------------ */

configureApi({
  baseURL: '/api/v1',
  getAuthToken: () => localStorage.getItem('access_token'),
  onUnauthorized: () => {
    localStorage.removeItem('access_token');
    window.location.assign('/login');
  },
});

export function Root() {
  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#1677ff' } }}>
      {/* App supplies the context-aware message/notification instances… */}
      <App>
        {/* …and the bridge hands them to the api layer. */}
        <ApiFeedbackBridge>
          <GlobalLoadingBar />
          <UsersPanel />
        </ApiFeedbackBridge>
      </App>
    </ConfigProvider>
  );
}

/** Any component, anywhere, can watch every in-flight request. */
function GlobalLoadingBar() {
  const loading = useGlobalLoading();
  return <Spin spinning={loading} fullscreen tip="Loading…" />;
}

/* ------------------------------------------------------------------ *
 * 2. Services — plain functions, no React
 * ------------------------------------------------------------------ */

interface User {
  id: string;
  name: string;
  email: string;
}

const usersService = {
  list: (page: number, signal?: AbortSignal): Promise<ApiResponse<User[]>> =>
    api.get('/users', { params: { page }, signal }),

  create: (body: Omit<User, 'id'>, signal?: AbortSignal): Promise<ApiResponse<User>> =>
    api.post('/users', body, { signal }),
};

/* ------------------------------------------------------------------ *
 * 3. Components
 * ------------------------------------------------------------------ */

function UsersPanel() {
  // A query: fires on mount, refetches when `page` changes.
  const users = useApi(({ signal }, page: number) => usersService.list(page, signal), {
    immediate: true,
    defaultArgs: [1],
    initialData: [],
    deps: [1],
  });

  // A mutation: fired by hand, reports both ends, and never toasts field-level
  // validation (the form renders that inline instead).
  const [form] = Form.useForm<Omit<User, 'id'>>();
  const createUser = useApi(
    ({ signal }, body: Omit<User, 'id'>) => usersService.create(body, signal),
    {
      channel: 'notification',
      successMessage: (user) => `${user.name} was added.`,
      errorMessage: (error) => (error.httpStatus === 422 ? null : error.message),
      onSuccess: () => {
        form.resetFields();
        void users.run(1);
      },
      onError: (error) => {
        // `field` on the server is a dotted path; AntD wants a known field
        // name, so keep only the ones this form actually renders.
        const fields = Object.entries(error.fieldErrors).filter(
          (entry): entry is [keyof Omit<User, 'id'>, string] =>
            entry[0] === 'name' || entry[0] === 'email',
        );
        if (fields.length) {
          form.setFields(fields.map(([name, message]) => ({ name, errors: [message] })));
        }
      },
    },
  );

  useEffect(() => {
    if (users.metadata?.request_id) {
      console.debug('served by request', users.metadata.request_id);
    }
  }, [users.metadata]);

  return (
    <>
      <Table<User>
        rowKey="id"
        dataSource={users.data}
        loading={users.loading}
        pagination={{ total: users.metadata?.pagination?.total_items ?? 0 }}
        onChange={(pagination) => void users.run(pagination.current ?? 1)}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Email', dataIndex: 'email' },
        ]}
      />

      <Form form={form} layout="inline" onFinish={(values) => void createUser.run(values)}>
        <Form.Item name="name" rules={[{ required: true }]}>
          <Input placeholder="Name" />
        </Form.Item>
        <Form.Item name="email" rules={[{ required: true, type: 'email' }]}>
          <Input placeholder="Email" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={createUser.loading}>
          Add user
        </Button>
      </Form>
    </>
  );
}
