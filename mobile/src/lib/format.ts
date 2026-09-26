import type { ActionStatus } from '@shared/api';

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export const STATUS_LABEL: Record<ActionStatus, string> = {
  awaiting_confirmation: 'Awaiting confirmation',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Not done',
};

export function statusTone(status: ActionStatus): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const tones = { succeeded: 'success', failed: 'danger', cancelled: 'neutral', awaiting_confirmation: 'warning', running: 'accent' } as const;
  return tones[status];
}

const FAILURE_LABEL: Record<string, string> = {
  invalid_credentials: 'Wrong username or password',
  forbidden: 'Not allowed',
  unavailable: 'System unavailable',
  error: 'System error',
};

export function failureLabel(reason: string | null): string {
  return (reason && FAILURE_LABEL[reason]) ?? 'Failed';
}
