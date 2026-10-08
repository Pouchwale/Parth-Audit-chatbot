import type {
  AccountDetail,
  AccountSummary,
  ApiError as ApiErrorBody,
  AssistantReply,
  Capabilities,
  ConversationDetail,
  ConversationExport,
  ConversationSummary,
  DecisionRequest,
  ExportDetail,
  ExportPage,
  ExportRequest,
  FileInfo,
  FilePurpose,
  LoginRequest,
  LoginResponse,
  MeResponse,
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
import { serverAddress, unreachableMessage } from './server-address';

/**
 * Where the Mitra server is (lib/server-address.ts): EXPO_PUBLIC_API_URL when it was set where the app was bundled;
 * in a browser, the page's own computer; in Expo Go, the computer it loaded the app from, which runs the server too.
 */
function findServer(): string | null {
  return serverAddress({
    configured: process.env.EXPO_PUBLIC_API_URL,
    page: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location : null,
    expoAddresses: [Constants.expoConfig?.hostUri, Constants.expoGoConfig?.debuggerHost, Constants.linkingUri],
  });
}

/** The Mitra server's address, or null when this copy of the app can't tell where it is. */
export const SERVER_URL: string | null = findServer();

/** The server's address for a request; when the app can't tell where it is, the error that says what to do. */
export function serverBase(): string {
  if (!SERVER_URL) throw unreachable();
  return SERVER_URL;
}

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

/** The error for a request that never reached the server: what to try, in plain words, with the address it tried. */
export function unreachable(): ApiError {
  return new ApiError(0, 'network', unreachableMessage(SERVER_URL, Platform.OS === 'web' ? 'computer' : 'phone'));
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

  const url = `${serverBase()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: payload, signal });
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
  return `${serverBase()}${filePath(fileId, purpose)}`;
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
  me: (token: string) => request<MeResponse>('/me', { token }),
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
