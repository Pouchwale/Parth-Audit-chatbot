import { z } from 'zod';
import type { Action, Connector } from './types.ts';

export interface ToolBinding {
  /** Name the model sees: "<connector id>__<action name>". */
  toolName: string;
  connector: Connector;
  action: Action;
}

export interface Registry {
  connectors: readonly Connector[];
  /** The connector people sign in with. */
  signIn: Connector;
  bindings: readonly ToolBinding[];
  find(toolName: string): ToolBinding | undefined;
}

const ID = /^[a-z][a-z0-9_]*$/;

export function createRegistry(connectors: readonly Connector[], signInConnectorId: string): Registry {
  const byTool = new Map<string, ToolBinding>();
  const ids = new Set<string>();
  for (const connector of connectors) {
    if (!ID.test(connector.id) || connector.id.includes('__')) throw new Error(`Invalid connector id "${connector.id}"`);
    if (ids.has(connector.id)) throw new Error(`Duplicate connector id "${connector.id}"`);
    ids.add(connector.id);
    for (const action of connector.actions) {
      const toolName = `${connector.id}__${action.name}`;
      if (!ID.test(action.name) || toolName.length > 64) throw new Error(`Invalid action name "${toolName}"`);
      if (byTool.has(toolName)) throw new Error(`Duplicate action "${toolName}"`);
      if (z.toJSONSchema(action.input, { io: 'input' }).type !== 'object') {
        throw new Error(`Action "${toolName}" input must be a z.object()`);
      }
      byTool.set(toolName, { toolName, connector, action });
    }
  }
  const signIn = connectors.find((c) => c.id === signInConnectorId);
  if (!signIn) throw new Error(`Sign-in connector "${signInConnectorId}" is not registered`);

  return {
    connectors,
    signIn,
    bindings: [...byTool.values()],
    find: (toolName) => byTool.get(toolName),
  };
}
