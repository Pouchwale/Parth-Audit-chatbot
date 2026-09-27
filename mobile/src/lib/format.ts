import type { ActionStatus, ConversationSummary, ExportDevice, Role } from '@shared/api';

export const ROLE_LABEL: Record<Role, string> = {
  user: 'Member',
  super_admin: 'Super admin',
};

/** A conversation's name in lists: its title, or until it gets one, the start of its latest message. */
export function conversationTitle(conversation: ConversationSummary): string {
  return conversation.title || conversation.preview || 'New chat';
}

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

/** e.g. "1 message", "3 messages". */
export function count(amount: number, singular: string, plural = `${singular}s`): string {
  return `${amount.toLocaleString()} ${amount === 1 ? singular : plural}`;
}

/** e.g. "812 B", "4.2 KB", "31 KB", "1.5 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const [size, unit] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / (1024 * 1024), 'MB'];
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${unit}`;
}

/** The operating system and its version, e.g. "Android 15". */
export function systemName(device: Pick<ExportDevice, 'os' | 'osVersion'>): string | null {
  return [device.os, device.osVersion].filter(Boolean).join(' ') || null;
}

/** The device and its system in a line, e.g. "Parth's Pixel · Android 15". */
export function deviceSummary(device: ExportDevice | null): string | null {
  if (!device) return null;
  return [device.name ?? device.model, systemName(device)].filter(Boolean).join(' · ') || null;
}
