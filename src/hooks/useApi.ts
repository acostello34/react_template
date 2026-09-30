import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toApiError } from '../api/client';
import { notify, type NotifyChannel } from '../api/notifier';
import { ApiError, type ApiMetadata, type ApiResponse } from '../api/types';

export interface ApiContext {
  /** Aborted when the call is superseded, canceled, or the component unmounts. */
  signal: AbortSignal;
}

/**
 * A service function. Context comes first so that TypeScript can always infer
 * the caller's own arguments, however many there are:
 *
 *   useApi(({ signal }, page: number) =>
 *     api.get<User[]>('/users', { params: { page }, signal }))
 */
export type ApiFn<TData, TArgs extends unknown[]> = (
  ctx: ApiContext,
  ...args: TArgs
) => Promise<ApiResponse<TData>>;

export interface UseApiOptions<TData, TArgs extends unknown[]> {
  /** Fire on mount (and whenever `deps` change) with `defaultArgs`. */
  immediate?: boolean;
  defaultArgs?: TArgs;
  initialData?: TData;

  /** Re-run when these change. Must keep a stable length, like a deps array. */
  deps?: unknown[];

  /** Where feedback goes. Notifications suit long text and mutations. */
  channel?: NotifyChannel;
  /** Shown on success. Omit for silent reads. Return null to skip. */
  successMessage?: string | ((data: TData, response: ApiResponse<TData>) => string | null);
  /** Defaults to `error.message`. Return null to skip this one. */
  errorMessage?: string | ((error: ApiError) => string | null);
  /** Set false to own error feedback yourself (inline alerts, form fields). */
  showError?: boolean;
  /** Collapses repeat toasts into one. Defaults to the error code. */
  notifyKey?: string;

  onSuccess?: (data: TData, response: ApiResponse<TData>) => void;
  onError?: (error: ApiError) => void;
  onSettled?: () => void;

  /** Abort the in-flight call when a new one starts. Default true. */
  cancelPrevious?: boolean;
  /** Abort on unmount. Default true — turn off for fire-and-forget writes. */
  cancelOnUnmount?: boolean;
}

export interface UseApiResult<TData, TArgs extends unknown[]> {
  data: TData | undefined;
  metadata: ApiMetadata | undefined;
  error: ApiError | null;
  /** True while this hook's own request is in flight. */
  loading: boolean;
  /** False until the first call resolves or rejects. */
  called: boolean;
  /** Runs and swallows the error (already reported). Resolves to the data. */
  run: (...args: TArgs) => Promise<TData | undefined>;
  /** Same, but rejects with `ApiError` — for `try/catch` in a submit handler. */
  runAsync: (...args: TArgs) => Promise<TData>;
  cancel: () => void;
  reset: () => void;
  setData: (updater: TData | ((previous: TData | undefined) => TData)) => void;
}

interface State<TData> {
  data: TData | undefined;
  metadata: ApiMetadata | undefined;
  error: ApiError | null;
  loading: boolean;
  called: boolean;
}

/**
 * One request, its lifecycle, and its user-facing feedback.
 *
 * Handles the parts that get re-invented per component: cancellation of
 * superseded calls, ignoring responses that land after unmount, normalizing
 * every failure into `ApiError`, and routing messages through AntD.
 */
export function useApi<TData, TArgs extends unknown[] = []>(
  fn: ApiFn<TData, TArgs>,
  options: UseApiOptions<TData, TArgs> = {},
): UseApiResult<TData, TArgs> {
  const {
    immediate = false,
    defaultArgs,
    initialData,
    deps,
    cancelOnUnmount = true,
  } = options;

  const [state, setState] = useState<State<TData>>({
    data: initialData,
    metadata: undefined,
    error: null,
    loading: false,
    called: false,
  });

  // Refs keep `run` stable across renders, so it is safe in deps arrays and
  // event handlers without the caller memoizing their service function.
  const fnRef = useRef(fn);
  const optionsRef = useRef(options);
  fnRef.current = fn;
  optionsRef.current = options;

  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const callIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cancelOnUnmount) controllerRef.current?.abort();
    };
  }, [cancelOnUnmount]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    // Bump the id so a response already in flight is treated as stale.
    callIdRef.current += 1;
    setState((previous) => (previous.loading ? { ...previous, loading: false } : previous));
  }, []);

  const runAsync = useCallback(async (...args: TArgs): Promise<TData> => {
    const config = optionsRef.current;

    if (config.cancelPrevious !== false) controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    const callId = ++callIdRef.current;
    const isCurrent = () => mountedRef.current && callIdRef.current === callId;

    setState((previous) => ({ ...previous, loading: true, error: null }));

    try {
      const response = await fnRef.current({ signal: controller.signal }, ...args);
      if (!isCurrent()) return response.data;

      setState({
        data: response.data,
        metadata: response.metadata,
        error: null,
        loading: false,
        called: true,
      });

      const text = resolve(config.successMessage, response.data, response);
      if (text) {
        notify('success', text, { channel: config.channel, key: config.notifyKey });
      }
      config.onSuccess?.(response.data, response);
      return response.data;
    } catch (caught) {
      const error = toApiError(caught);

      // A canceled call was replaced by a newer one (or the component went
      // away): its owner is gone, so it neither reports nor clears state.
      if (error.isCanceled || !isCurrent()) throw error;

      setState((previous) => ({ ...previous, error, loading: false, called: true }));

      if (config.showError !== false) {
        const text = resolve(config.errorMessage, error) ?? error.message;
        if (text) {
          notify('error', text, {
            channel: config.channel,
            key: config.notifyKey ?? error.code,
          });
        }
      }
      config.onError?.(error);
      throw error;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (isCurrent()) optionsRef.current.onSettled?.();
    }
  }, []);

  const run = useCallback(
    async (...args: TArgs): Promise<TData | undefined> => {
      try {
        return await runAsync(...args);
      } catch {
        return undefined; // Already surfaced via notify/onError.
      }
    },
    [runAsync],
  );

  const reset = useCallback(() => {
    cancel();
    setState({
      data: optionsRef.current.initialData,
      metadata: undefined,
      error: null,
      loading: false,
      called: false,
    });
  }, [cancel]);

  const setData = useCallback(
    (updater: TData | ((previous: TData | undefined) => TData)) => {
      setState((previous) => ({
        ...previous,
        data:
          typeof updater === 'function'
            ? (updater as (p: TData | undefined) => TData)(previous.data)
            : updater,
      }));
    },
    [],
  );

  useEffect(() => {
    if (!immediate) return;
    void run(...((defaultArgs ?? []) as TArgs));
    // `deps` is spread deliberately: it is the caller's own dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, run, ...(deps ?? [])]);

  return useMemo(
    () => ({ ...state, run, runAsync, cancel, reset, setData }),
    [state, run, runAsync, cancel, reset, setData],
  );
}

function resolve<TValue extends unknown[]>(
  source: string | ((...args: TValue) => string | null) | undefined,
  ...args: TValue
): string | null {
  if (source === undefined) return null;
  return typeof source === 'function' ? source(...args) : source;
}

export { ApiError };
