import { App, message as staticMessage, notification as staticNotification } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';
import { useEffect, type ReactNode } from 'react';

/**
 * Bridge between AntD's context-aware feedback APIs and plain modules.
 *
 * AntD v5 warns when you call the static `message.error(...)` because those
 * instances miss the theme/locale from `ConfigProvider`. The instances from
 * `App.useApp()` are correct but only reachable inside a component — so we
 * stash them in a module slot on mount and let the api layer read them from
 * there. The static instances stay as a fallback so a request firing before
 * the bridge mounts still shows something.
 */

type Feedback = {
  message: MessageInstance;
  notification: NotificationInstance;
};

let current: Feedback = {
  message: staticMessage,
  notification: staticNotification,
};

export function getFeedback(): Feedback {
  return current;
}

/**
 * Mount once, inside `<App>` (which itself goes inside `<ConfigProvider>`).
 * Renders its children untouched.
 */
export function ApiFeedbackBridge({ children }: { children?: ReactNode }) {
  const { message, notification } = App.useApp();

  useEffect(() => {
    current = { message, notification };
    return () => {
      current = { message: staticMessage, notification: staticNotification };
    };
  }, [message, notification]);

  return <>{children}</>;
}

export type NotifyChannel = 'message' | 'notification';
export type NotifyLevel = 'success' | 'error' | 'warning' | 'info';

export interface NotifyOptions {
  channel?: NotifyChannel;
  /** Heading — only used by the notification channel. */
  title?: string;
  /**
   * Passing a key collapses repeats: a retry loop shows one toast that
   * updates in place instead of stacking twelve identical ones.
   */
  key?: string;
  duration?: number;
}

export function notify(
  level: NotifyLevel,
  content: string,
  { channel = 'message', title, key, duration }: NotifyOptions = {},
): void {
  const feedback = getFeedback();

  if (channel === 'notification') {
    feedback.notification[level]({
      message: title ?? defaultTitle(level),
      description: content,
      key,
      duration,
      placement: 'topRight',
    });
    return;
  }

  feedback.message.open({ type: level, content, key, duration });
}

function defaultTitle(level: NotifyLevel): string {
  switch (level) {
    case 'success':
      return 'Success';
    case 'error':
      return 'Request failed';
    case 'warning':
      return 'Warning';
    default:
      return 'Notice';
  }
}
