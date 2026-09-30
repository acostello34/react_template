import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type CreateAxiosDefaults,
  type InternalAxiosRequestConfig,
} from 'axios';

import { globalLoading } from './loadingStore';
import {
  ApiError,
  type ApiErrorDetail,
  type ApiMetadata,
  type ApiResponse,
} from './types';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Opt this request out of the global spinner (background polling, etc.). */
    globalLoading?: boolean;
    /** Internal: set once the counter has actually been incremented. */
    __loadingStarted?: boolean;
  }
}

export interface ApiClientConfig {
  baseURL?: string;
  timeout?: number;
  /** Called per request; return null to send no Authorization header. */
  getAuthToken?: () => string | null | undefined;
  /** Fired once per 401 — clear the session and redirect here. */
  onUnauthorized?: (error: ApiError) => void;
  /** Fired for every failure, after normalization. Logging/telemetry hook. */
  onError?: (error: ApiError) => void;
  defaults?: CreateAxiosDefaults;
}

let settings: ApiClientConfig = {};

/** Call once at app startup, before the first request. */
export function configureApi(config: ApiClientConfig): void {
  settings = { ...settings, ...config };
  if (config.baseURL !== undefined) http.defaults.baseURL = config.baseURL;
  if (config.timeout !== undefined) http.defaults.timeout = config.timeout;
}

/** Raw axios instance — escape hatch for file uploads, streams, third parties. */
export const http: AxiosInstance = axios.create({
  // Override at startup with `configureApi({ baseURL: import.meta.env.VITE_API_BASE_URL })`.
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  // Repeat keys for array params (`status=a&status=b`), which is what FastAPI's
  // `Query(None)` list parameters expect. Axios would otherwise send `status[]=a`.
  paramsSerializer: { indexes: null },
});

http.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = settings.getAuthToken?.();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);

    if (config.globalLoading !== false) {
      globalLoading.start();
      config.__loadingStarted = true;
    }
    return config;
  },
  (error: unknown) => Promise.reject(toApiError(error)),
);

http.interceptors.response.use(
  (response: AxiosResponse) => {
    releaseLoading(response.config);

    // A 2xx carrying `status: "error"` is still a failure. Reject it here so
    // callers only ever branch on success/throw, never on the envelope.
    const body = response.data;
    if (isEnvelope(body) && body.status === 'error') {
      throw dispatch(errorFromEnvelope(body, response.status));
    }
    return response;
  },
  (error: unknown) => {
    if (error instanceof ApiError) return Promise.reject(error);
    releaseLoading((error as AxiosError)?.config);
    return Promise.reject(dispatch(toApiError(error)));
  },
);

function releaseLoading(config?: { __loadingStarted?: boolean }): void {
  if (config?.__loadingStarted) {
    config.__loadingStarted = false;
    globalLoading.done();
  }
}

function dispatch(error: ApiError): ApiError {
  if (error.isCanceled) return error;
  if (error.httpStatus === 401) settings.onUnauthorized?.(error);
  settings.onError?.(error);
  return error;
}

/* ------------------------------------------------------------------ *
 * Envelope normalization
 * ------------------------------------------------------------------ */

function isEnvelope(body: unknown): body is ApiResponse<unknown> {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    'data' in body &&
    typeof (body as ApiResponse<unknown>).status === 'string'
  );
}

/**
 * Accepts either the standard envelope or a bare payload, and always hands
 * back an envelope — so endpoints that predate the standard (or belong to a
 * third party) still work with `useApi`.
 */
function normalize<T>(response: AxiosResponse): ApiResponse<T> {
  const body = response.data;
  if (isEnvelope(body)) {
    return { ...body, data: body.data as T, metadata: body.metadata ?? {} };
  }
  return {
    status: 'success',
    data: body as T,
    metadata: metadataFromHeaders(response),
  };
}

function metadataFromHeaders(response: AxiosResponse): ApiMetadata {
  const requestId = response.headers?.['x-request-id'];
  return typeof requestId === 'string' ? { request_id: requestId } : {};
}

function errorFromEnvelope(body: ApiResponse<unknown>, httpStatus?: number): ApiError {
  const details = (body.errors ?? []) as ApiErrorDetail[];
  return new ApiError(body.message || details[0]?.message || 'Request failed', {
    code: details[0]?.code ?? 'api_error',
    httpStatus,
    details,
    requestId: body.metadata?.request_id,
    cause: body,
  });
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isCancel(error)) {
    return new ApiError('Request canceled', { code: 'canceled', isCanceled: true, cause: error });
  }

  if (axios.isAxiosError(error)) {
    if (error.code === AxiosError.ERR_CANCELED) {
      return new ApiError('Request canceled', { code: 'canceled', isCanceled: true, cause: error });
    }

    const response = error.response;
    if (!response) {
      const timedOut =
        error.code === AxiosError.ECONNABORTED || error.code === AxiosError.ETIMEDOUT;
      return new ApiError(
        timedOut ? 'The server took too long to respond.' : 'Unable to reach the server.',
        {
          code: timedOut ? 'timeout' : 'network_error',
          isNetworkError: true,
          cause: error,
        },
      );
    }

    if (isEnvelope(response.data)) {
      return errorFromEnvelope(response.data, response.status);
    }

    // FastAPI's own shapes: `{"detail": "..."}` or a 422 validation array.
    const detail = (response.data as { detail?: unknown })?.detail;
    return new ApiError(readDetailMessage(detail) ?? httpMessage(response.status), {
      code: `http_${response.status}`,
      httpStatus: response.status,
      details: readValidationDetails(detail),
      requestId: response.headers?.['x-request-id'] as string | undefined,
      cause: error,
    });
  }

  return new ApiError(error instanceof Error ? error.message : 'Unexpected error', {
    cause: error,
  });
}

type FastApiValidationError = { loc?: (string | number)[]; msg?: string; type?: string };

function readDetailMessage(detail: unknown): string | undefined {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const first = detail[0] as FastApiValidationError | undefined;
    return first?.msg;
  }
  return undefined;
}

function readValidationDetails(detail: unknown): ApiErrorDetail[] {
  if (!Array.isArray(detail)) return [];
  return (detail as FastApiValidationError[]).map((item) => ({
    code: item.type ?? 'validation_error',
    message: item.msg ?? 'Invalid value',
    // Drop the leading "body"/"query" segment so the path matches form names.
    field: item.loc?.slice(1).join('.') || null,
  }));
}

function httpMessage(status: number): string {
  switch (status) {
    case 400:
      return 'The request was invalid.';
    case 401:
      return 'Your session has expired. Please sign in again.';
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return 'We could not find what you were looking for.';
    case 409:
      return 'That conflicts with something that already exists.';
    case 422:
      return 'Some of the submitted values are invalid.';
    case 429:
      return 'Too many requests — please slow down.';
    default:
      return status >= 500 ? 'Something went wrong on our end.' : 'Request failed.';
  }
}

/* ------------------------------------------------------------------ *
 * Typed verb helpers — each resolves to the full envelope
 * ------------------------------------------------------------------ */

type Config = Parameters<AxiosInstance['get']>[1];

export const api = {
  get: <T>(url: string, config?: Config): Promise<ApiResponse<T>> =>
    http.get(url, config).then(normalize<T>),

  post: <T>(url: string, body?: unknown, config?: Config): Promise<ApiResponse<T>> =>
    http.post(url, body, config).then(normalize<T>),

  put: <T>(url: string, body?: unknown, config?: Config): Promise<ApiResponse<T>> =>
    http.put(url, body, config).then(normalize<T>),

  patch: <T>(url: string, body?: unknown, config?: Config): Promise<ApiResponse<T>> =>
    http.patch(url, body, config).then(normalize<T>),

  delete: <T>(url: string, config?: Config): Promise<ApiResponse<T>> =>
    http.delete(url, config).then(normalize<T>),
};
