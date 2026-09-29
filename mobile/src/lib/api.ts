import type {
  AccountDetail,
  AccountSummary,
  ApiError as ApiErrorBody,
  AssistantReply,
  Capabilities,
  ConversationDetail,
  ConversationExport,
  ConversationSummary,
  CurrentUser,
  DecisionRequest,
  ExportDetail,
  ExportPage,
  ExportRequest,
  FileInfo,
  FilePurpose,
  LoginRequest,
  LoginResponse,
  MessageRequest,
  RenameConversationRequest,
  SignInInfo,
  TranscriptionResponse,
  WeeklyReport,
  WeeklyReportSummary,
} from '@shared/api';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { timeZone } from './device';

const DEV_SERVER_PORT = 3000;

/**
 * EXPO_PUBLIC_API_URL when set (production builds). In development the server runs on the same
 * computer as Expo, so use that computer's address: the page's host on web, and the address the
 * phone loaded the app from on Expo Go or a development build.
 */
function serverUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${DEV_SERVER_PORT}`;
  }
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${DEV_SERVER_PORT}`;
}

export const SERVER_URL = serverUrl();
const BASE_URL = SERVER_URL;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The error for a request that never reached the server. */
export function unreachable(): ApiError {
  return new ApiError(
    0,
    'network',
    `Can't reach the assistant server at ${BASE_URL}. Make sure it's running and this device is on the same network, then try again.`,
  );
}

/** The error the server answered with, taken from its JSON body when it has one. */
export async function requestFailed(response: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  const data = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
  return new ApiError(response.status, data?.error ?? 'error', data?.message ?? 'Something went wrong. Try again.');
}

/** A file to upload: its bytes on phones, a Blob in browsers. */
export type FileData = Uint8Array<ArrayBuffer> | Blob;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as the raw request body with its own content type. */
  upload?: { data: FileData; contentType: string };
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Sends a request, and answers the response when it succeeded. */
async function send(path: string, { method = 'GET', token, body, upload, headers: extra, signal }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (upload) {
    headers['content-type'] = upload.contentType;
    payload = upload.data;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, { method, headers, body: payload, signal });
  } catch {
    throw unreachable();
  }
  if (!response.ok) throw await requestFailed(response);
  return response;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => null)) as T;
}

/** A file's content. The device's time zone goes along, for the download record. */
async function requestFile(path: string, token: string): Promise<ArrayBuffer> {
  const zone = timeZone();
  const response = await send(path, { token, headers: zone ? { 'x-time-zone': zone } : undefined });
  try {
    return await response.arrayBuffer();
  } catch {
    throw unreachable();
  }
}

export function conversationPath(conversationId: string): string {
  return `/assistant/conversations/${encodeURIComponent(conversationId)}`;
}

function filePath(fileId: string, purpose: FilePurpose): string {
  return `/assistant/files/${encodeURIComponent(fileId)}${query({ purpose })}`;
}

/** Where a file's content is, for loading it with the session token in a header. */
export function fileUrl(fileId: string, purpose: FilePurpose): string {
  return `${BASE_URL}${filePath(fileId, purpose)}`;
}

/** Which downloads to list. All of them must match; leave one out to not filter by it. */
export interface ExportFilters {
  userId?: string;
  /** An ISO date, meaning from the start of that day in the server's report time zone, or an ISO date-time. */
  from?: string;
  /** An ISO date, meaning to the end of that day in the server's report time zone, or an ISO date-time. */
  to?: string;
  /** An export ID, a fingerprint or its first 12 or more characters, or part of a title, file name, system or username. */
  q?: string;
}

/** A query string of the parameters that have a value. */
function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
}

export const api = {
  signInInfo: () => request<SignInInfo>('/auth/provider'),
  login: (body: LoginRequest) => request<LoginResponse>('/auth/login', { method: 'POST', body }),
  logout: (token: string) => request<void>('/auth/logout', { method: 'POST', token }),
  me: (token: string) => request<{ user: CurrentUser }>('/me', { token }),
  capabilities: (token: string) => request<Capabilities>('/assistant/capabilities', { token }),
  send: (token: string, body: MessageRequest) => request<AssistantReply>('/assistant/messages', { method: 'POST', body, token }),
  decide: (token: string, conversationId: string, body: DecisionRequest) =>
    request<AssistantReply>(`${conversationPath(conversationId)}/decision`, { method: 'POST', body, token }),
  conversations: (token: string) => request<ConversationSummary[]>('/assistant/conversations', { token }),
  conversation: (token: string, conversationId: string) => request<ConversationDetail>(conversationPath(conversationId), { token }),
  renameConversation: (token: string, conversationId: string, body: RenameConversationRequest) =>
    request<ConversationSummary>(conversationPath(conversationId), { method: 'PATCH', body, token }),
  deleteConversation: (token: string, conversationId: string) => request<void>(conversationPath(conversationId), { method: 'DELETE', token }),
  deleteAllConversations: (token: string) => request<void>('/assistant/conversations', { method: 'DELETE', token }),
  /** Builds the conversation's file for downloading. The server records every export. */
  exportConversation: (token: string, conversationId: string, body: ExportRequest) =>
    request<ConversationExport>(`${conversationPath(conversationId)}/export`, { method: 'POST', body, token }),
  /** `contentType` is the recording's type, e.g. audio/mp4 for an .m4a file or the Blob's type on web. */
  transcribe: (token: string, data: FileData, contentType: string) =>
    request<TranscriptionResponse>('/assistant/transcribe', { method: 'POST', token, upload: { data, contentType } }),
  /** Uploads a file to attach to a message. `path` is where it sits inside a picked folder. */
  uploadFile: (token: string, file: { data: FileData; contentType: string; name: string; path: string | null }, signal?: AbortSignal) =>
    request<FileInfo>(`/assistant/files${query({ name: file.name, path: file.path ?? undefined })}`, {
      method: 'POST',
      token,
      upload: { data: file.data, contentType: file.contentType },
      signal,
    }),
  /** A file's content. Getting one a connected system returned is recorded in the download audit, with `purpose`. */
  file: (token: string, fileId: string, purpose: FilePurpose) => requestFile(filePath(fileId, purpose), token),
  accounts: (token: string) => request<AccountSummary[]>('/admin/accounts', { token }),
  account: (token: string, userId: string) => request<AccountDetail>(`/admin/accounts/${userId}`, { token }),
  signOutDevice: (token: string, sessionId: string) => request<void>(`/admin/sessions/${sessionId}/revoke`, { method: 'POST', token }),
  /** One page of downloads, newest first. `before` is the previous page's `nextBefore`. */
  exports: (token: string, filters: ExportFilters, before?: string) =>
    request<ExportPage>(`/admin/exports${query({ ...filters, before })}`, { token }),
  exportDetail: (token: string, exportId: string) => request<ExportDetail>(`/admin/exports/${encodeURIComponent(exportId)}`, { token }),
  /** The copy of a file kept with its download record. The server records this access too, as the admin's. */
  exportCopy: (token: string, exportId: string) => requestFile(`/admin/exports/${encodeURIComponent(exportId)}/file`, token),
  /** The week in progress first, then completed weeks, newest first. */
  weeklyReports: (token: string) => request<WeeklyReportSummary[]>('/admin/reports/weekly', { token }),
  weeklyReport: (token: string, weekStart: string) =>
    request<WeeklyReport>(`/admin/reports/weekly/${encodeURIComponent(weekStart)}`, { token }),
};

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}
