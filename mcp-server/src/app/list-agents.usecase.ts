import type { DevDigestApi } from '../ports/devdigest-api.js';
import { narrowAgent, type NarrowAgent } from '../domain/shape.js';

export interface ListAgentsInput {
  enabled_only?: boolean;
}

export interface ListAgentsOutput {
  agents: NarrowAgent[];
}

/** Application ring — one use-case per tool. list_agents maps 1:1 onto
 *  `GET /agents` (real, already-selectable entity — server/src/modules/agents). */
export function makeListAgentsUseCase(deps: { api: DevDigestApi }) {
  return async function listAgents(input: ListAgentsInput): Promise<ListAgentsOutput> {
    const agents = await deps.api.listAgents({ enabledOnly: input.enabled_only ?? true });
    return { agents: agents.map(narrowAgent) };
  };
}
