import type {
  AccountDetail,
  AccountSummary,
  AssistantReply,
  CurrentUser,
  DecisionRequest,
  LoginRequest,
  LoginResponse,
  MessageRequest,
  SignInInfo,
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

async function request<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(
      0,
      'network',
      `Can't reach the assistant server at ${BASE_URL}. Make sure it's running and this device is on the same network, then try again.`,
    );
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? 'error', data?.message ?? 'Something went wrong. Try again.');
  }
  return data as T;
}

export const api = {
  signInInfo: () => request<SignInInfo>('/auth/provider'),
  login:(body: LoginRequest) => request<LoginResponse>('/auth/login', { method: 'POST', body }),
  logout: (token: string) => request<void>('/auth/logout', { method: 'POST', token }),
  me: (token: string) => request<{ user: CurrentUser }>('/me', { token }),
  send: (token: string, body: MessageRequest) => request<AssistantReply>('/assistant/messages', { method: 'POST', body, token }),
  decide: (token: string, conversationId: string, body: DecisionRequest) =>
    request<AssistantReply>(`/assistant/conversations/${conversationId}/decision`, { method: 'POST', body, token }),
  accounts: (token: string) => request<AccountSummary[]>('/admin/accounts', { token }),
  account: (token: string, userId: string) => request<AccountDetail>(`/admin/accounts/${userId}`, { token }),
  signOutDevice: (token: string, sessionId: string) => request<void>(`/admin/sessions/${sessionId}/revoke`, { method: 'POST', token }),
};

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}
