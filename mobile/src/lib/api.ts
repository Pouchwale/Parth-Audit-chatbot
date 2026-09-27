import type {
  AccountDetail,
  AccountSummary,
  ApiError as ApiErrorBody,
  AssistantReply,
  Capabilities,
  ConversationDetail,
  ConversationSummary,
  CurrentUser,
  DecisionRequest,
  LoginRequest,
  LoginResponse,
  MessageRequest,
  RenameConversationRequest,
  SignInInfo,
  TranscriptionResponse,
} from '@shared/api';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

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

/** Recorded audio: the file's bytes on phones, the recording's Blob on web. */
export type AudioData = Uint8Array<ArrayBuffer> | Blob;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as the raw request body with its own content type. */
  upload?: { data: AudioData; contentType: string };
}

async function request<T>(path: string, { method = 'GET', token, body, upload }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
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
    response = await fetch(`${BASE_URL}${path}`, { method, headers, body: payload });
  } catch {
    throw unreachable();
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await requestFailed(response);
  return (await response.json().catch(() => null)) as T;
}

export function conversationPath(conversationId: string): string {
  return `/assistant/conversations/${encodeURIComponent(conversationId)}`;
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
  /** `contentType` is the recording's type, e.g. audio/mp4 for an .m4a file or the Blob's type on web. */
  transcribe: (token: string, data: AudioData, contentType: string) =>
    request<TranscriptionResponse>('/assistant/transcribe', { method: 'POST', token, upload: { data, contentType } }),
  accounts: (token: string) => request<AccountSummary[]>('/admin/accounts', { token }),
  account: (token: string, userId: string) => request<AccountDetail>(`/admin/accounts/${userId}`, { token }),
  signOutDevice: (token: string, sessionId: string) => request<void>(`/admin/sessions/${sessionId}/revoke`, { method: 'POST', token }),
};

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}
