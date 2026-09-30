/**
 * Wire types. These mirror `backend/app/schemas/response.py` one-for-one —
 * if you change the envelope on one side, change it on the other.
 */

export type ApiStatus = 'success' | 'error' | 'partial';

export interface ApiErrorDetail {
  /** Machine-readable, stable across releases (e.g. "validation_error"). */
  code: string;
  message: string;
  /** Dotted path to the offending field, for form-level error mapping. */
  field?: string | null;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface ApiMetadata {
  request_id?: string;
  timestamp?: string;
  duration_ms?: number;
  version?: string;
  pagination?: PaginationMeta | null;
  /** The backend allows extra keys here, so the client has to as well. */
  [key: string]: unknown;
}

export interface ApiResponse<T> {
  status: ApiStatus;
  message?: string | null;
  data: T;
  errors?: ApiErrorDetail[] | null;
  metadata: ApiMetadata;
}

/**
 * Every failure that leaves the api layer is an ApiError — axios errors,
 * envelopes with `status: "error"`, network drops and aborts alike. Callers
 * never have to sniff `err.response?.data?.detail` again.
 */
export class ApiError extends Error {
  readonly code: string;
  /** HTTP status, absent for network failures and aborts. */
  readonly httpStatus?: number;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;
  readonly isCanceled: boolean;
  readonly isNetworkError: boolean;
  /** Original axios error / envelope, for logging. */
  readonly cause?: unknown;

  constructor(
    message: string,
    init: {
      code?: string;
      httpStatus?: number;
      details?: ApiErrorDetail[];
      requestId?: string;
      isCanceled?: boolean;
      isNetworkError?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = init.code ?? 'unknown_error';
    this.httpStatus = init.httpStatus;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
    this.isCanceled = init.isCanceled ?? false;
    this.isNetworkError = init.isNetworkError ?? false;
    this.cause = init.cause;
  }

  /** Field -> message map, ready to hand to AntD's `Form.setFields`. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const detail of this.details) {
      if (detail.field) out[detail.field] = detail.message;
    }
    return out;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
