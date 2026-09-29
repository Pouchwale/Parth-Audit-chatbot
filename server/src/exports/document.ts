import type { ActionStatus, ActivityPart, AssistantMessage, ChatMessage, ConfirmationPart, FileInfo, MessagePart } from '@shared/api.ts';
import { NOT_CONFIRMED_IN_TIME } from '../agent/transcript.ts';
import { sizeLabel } from '../files/formats.ts';
import { localDate } from '../time.ts';

export const EXPORT_MIME_TYPE = 'text/markdown; charset=utf-8';

const APP_NAME = 'Audit Assistant';

export interface ExportInput {
  /** Printed in the file, so a copy that turns up somewhere can be traced back to this export. */
  id: string;
  conversationId: string;
  title: string;
  messages: ChatMessage[];
  exportedBy: { username: string; displayName: string };
  /** The system people sign in with. */
  signInSystem: string;
  at: Date;
  /** IANA time zone for every date in the file. */
  timeZone: string;
}

export interface ExportFile {
  filename: string;
  content: string;
}

const STATUS: Record<ActionStatus, string> = {
  awaiting_confirmation: 'awaiting confirmation',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
};

const DECISION: Record<ConfirmationPart['status'], string> = {
  pending: 'waiting for a decision',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  expired: 'expired before a decision',
};

/** A conversation as a Markdown file: who exported it and when, then every message in order with its time. */
export function exportFile(input: ExportInput): ExportFile {
  const when = dateTimeFormat(input.timeZone);
  const exportedOn = `${when(input.at)} (${input.timeZone})`;
  const { username, displayName } = input.exportedBy;

  const header = [
    `- Exported by ${displayName} (${username})`,
    `- Exported on ${exportedOn} · UTC ${input.at.toISOString()}`,
    `- Export ID: ${input.id}`,
    `- Conversation ID: ${input.conversationId}`,
    `- Signed in to ${input.signInSystem}`,
  ].join('\n');
  const messages = input.messages.flatMap((message) =>
    message.role === 'user'
      ? [`## ${displayName} · ${when(message.createdAt)}`, quote(message.text), ...attachmentBlocks(message.attachments ?? [])]
      : [`## ${APP_NAME} · ${when(message.createdAt)}`, ...assistantBlocks(message, input.at)],
  );
  const footer = `This file was exported from ${APP_NAME} by ${username} on ${exportedOn}. Export ID ${input.id}. Every export is recorded.`;

  const blocks = [`# ${input.title.replace(/\s+/g, ' ').trim()}`, header, '---', ...messages, '---', footer];
  return { filename: `${slug(input.title)}-${localDate(input.at, input.timeZone)}.md`, content: `${blocks.join('\n\n')}\n` };
}

function assistantBlocks(message: AssistantMessage, at: Date): string[] {
  const blocks = message.parts.map((part) => partBlock(part, at)).filter(Boolean);
  if (message.status === 'stopped') blocks.push('_Stopped before it finished._');
  if (message.status === 'error') blocks.push(`_Error: ${message.error ?? 'the reply failed.'}_`);
  if (message.status === 'streaming') blocks.push('_Still being written when this file was exported._');
  return blocks;
}

function attachmentBlocks(files: FileInfo[]): string[] {
  return files.length > 0 ? [['Attached:', ...files.map((file) => `- ${fileLine(file)}`)].join('\n')] : [];
}

function partBlock(part: MessagePart, at: Date): string {
  if (part.type === 'text') return part.text.trim();
  if (part.type === 'activity') return `${part.kind === 'read' ? 'Lookup' : 'Change'}: ${outcome(part)}`;
  if (part.type === 'file') return `File from ${part.file.system ?? 'a connected system'}: ${fileLine(part.file)}`;
  const shown = part.status === 'pending' && Date.parse(part.expiresAt) <= at.getTime() ? expired(part) : part;
  const changes = shown.changes.map((change) => `- ${outcome(change)}`);
  return [`Changes proposed for confirmation — ${DECISION[shown.status]}`, ...changes].join('\n');
}

/**
 * A confirmation nobody answered before it expired, as the server records it when it is next answered. Until then the
 * conversation still has it pending, though it can no longer be confirmed and maintenance cancels its changes in the log.
 */
function expired(part: ConfirmationPart): ConfirmationPart {
  return {
    ...part,
    status: 'expired',
    changes: part.changes.map((change) =>
      change.status === 'awaiting_confirmation' ? { ...change, status: 'cancelled', error: NOT_CONFIRMED_IN_TIME } : change,
    ),
  };
}

/** "site-a/photo-1.jpg (image/jpeg, 245 KB)" */
function fileLine(file: FileInfo): string {
  return `${file.relativePath ?? file.filename} (${file.mimeType}, ${sizeLabel(file.sizeBytes)})`;
}

function outcome(action: Pick<ActivityPart, 'summary' | 'system' | 'status' | 'error'>): string {
  return `${action.summary} (${action.system}) — ${STATUS[action.status]}${action.error ? `: ${action.error}` : ''}`;
}

/** What the person wrote, as a quote, so none of it can pass for the file's own headings. */
function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

/** "Sunday, 27 September 2026, 11:52:03" in the zone. */
function dateTimeFormat(timeZone: string): (instant: Date | string) => string {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return (instant) => {
    const part = Object.fromEntries(format.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    return `${part.weekday}, ${part.day} ${part.month} ${part.year}, ${part.hour}:${part.minute}:${part.second}`;
  };
}

/** The title as a file name: ASCII letters and digits joined by hyphens, at most 60 characters. */
function slug(title: string): string {
  const ascii = title.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  return (
    ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-/, '')
      .slice(0, 60)
      .replace(/-$/, '') || 'conversation'
  );
}
