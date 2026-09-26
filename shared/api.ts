// The HTTP contract between the mobile app and the server.
// Types only: both sides import this file with `import type`, so it never ships as runtime code.

export interface DeviceInfo {
  /** Random ID the app generates once per install and keeps. */
  deviceId: string;
  /** Name the owner gave the device, e.g. "Parth's Pixel". */
  name?: string | null;
  /** Hardware model, e.g. "Pixel 8" or "iPhone 15". */
  model?: string | null;
  /** e.g. "Android", "iOS", "Web". */
  os?: string | null;
  osVersion?: string | null;
  appVersion?: string | null;
}

export type Role = 'user' | 'super_admin';

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface LoginRequest {
  username: string;
  password: string;
  device: DeviceInfo;
}

export interface LoginResponse {
  token: string;
  user: CurrentUser;
}

export interface MessageRequest {
  /** Omit to start a new conversation. */
  conversationId?: string;
  text: string;
  /** IANA time zone of the device (e.g. "Asia/Kolkata"), so "tomorrow" means the person's tomorrow. */
  timeZone?: string;
}

export interface DecisionRequest {
  confirmationId: string;
  decision: 'confirm' | 'cancel';
  timeZone?: string;
}

export interface PendingChange {
  /** Name of the connected system, e.g. "Digital Controlled Record System". */
  system: string;
  /** Plain-language description of exactly what will be done if the person confirms. */
  summary: string;
}

export interface Confirmation {
  id: string;
  changes: PendingChange[];
  expiresAt: string;
}

export interface AssistantReply {
  conversationId: string;
  /** What the assistant says. Can be empty when it is only asking for confirmation. */
  reply: string;
  /** Changes waiting for the person to confirm or cancel. Nothing is changed until they confirm. */
  confirmation: Confirmation | null;
}

export type ActionStatus = 'awaiting_confirmation' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface ActionEntry {
  id: string;
  system: string;
  action: string;
  kind: 'read' | 'write';
  summary: string;
  status: ActionStatus;
  error: string | null;
  /** What the person said that led to this action. */
  request: string | null;
  at: string;
}

export interface SessionEntry {
  id: string;
  deviceName: string | null;
  deviceModel: string | null;
  os: string | null;
  osVersion: string | null;
  appVersion: string | null;
  signInIp: string | null;
  lastIp: string | null;
  signedInAt: string;
  lastSeenAt: string;
}

export interface LoginEntry {
  id: string;
  success: boolean;
  failureReason: string | null;
  ip: string | null;
  device: DeviceInfo | null;
  at: string;
}

export interface AccountSummary {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  /** Devices where this account is signed in right now. */
  activeSessions: number;
  lastSeenAt: string | null;
  lastAction: ActionEntry | null;
}

export interface AccountDetail {
  account: AccountSummary;
  /** Signed-in devices, most recently used first. */
  sessions: SessionEntry[];
  recentActions: ActionEntry[];
  recentLogins: LoginEntry[];
}

export interface ApiError {
  error: string;
  message: string;
}
