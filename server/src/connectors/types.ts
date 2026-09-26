import type { z } from 'zod';

/**
 * A connector is one external system the assistant can act on, described as a small, explicit
 * list of actions. The assistant can do nothing else with that system.
 */
export interface Connector {
  /** Stable id used in tool names, logs and stored credentials, e.g. "dcrs". Lowercase letters, digits, underscores. */
  id: string;
  /** Name people see, e.g. "Digital Controlled Record System". */
  name: string;
  /** One or two sentences telling the assistant what this system holds and when to use it. */
  description: string;
  actions: readonly Action[];
  /** Checks a person's username and password with this system and returns their account and credentials. */
  authenticate(username: string, password: string): Promise<ConnectorAccount>;
  /** Best-effort sign-out with the system when a session ends. */
  signOut?(credentials: unknown): Promise<void>;
}

export interface ConnectorAccount {
  /** The system's own stable id for this person. */
  externalId: string;
  username: string;
  displayName: string;
  /** Whatever the connector needs to call the system as this person (token, cookie...). Stored encrypted. */
  credentials: unknown;
  /** When the credentials stop working, if the system says. */
  expiresAt?: Date | null;
}

/** read: runs straight away. write: changes data, so the person always confirms it first. */
export type ActionKind = 'read' | 'write';

export interface Action<Input = any> {
  /** snake_case, unique within the connector. */
  name: string;
  /** Tells the assistant what this does and when to use it. */
  description: string;
  kind: ActionKind;
  /** Must be a z.object(). Validated on the server before anything runs. */
  input: z.ZodType<Input>;
  /**
   * One plain sentence saying exactly what this call does, e.g. "Close finding F-102 as resolved".
   * Shown on the confirmation card and in the admin action log, so it must come from the input, not the model.
   */
  describe(input: Input): string;
  /** Calls the system. The result goes back to the assistant as JSON, so keep it small and relevant. */
  run(ctx: ActionContext, input: Input): Promise<unknown>;
}

export interface ActionContext {
  /** The credentials this connector returned from authenticate() for the signed-in person. */
  credentials: unknown;
}

/** Declares an action with its input type inferred from the zod schema. */
export function defineAction<Input>(action: Action<Input>): Action<Input> {
  return action;
}

export type ConnectorErrorKind =
  | 'invalid_credentials' // wrong username or password
  | 'unauthorized' // the stored sign-in no longer works
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'conflict'
  | 'unavailable';

/** Thrown by connectors. The message must be safe and useful to show the person. */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;

  constructor(kind: ConnectorErrorKind, message: string) {
    super(message);
    this.name = 'ConnectorError';
    this.kind = kind;
  }
}
