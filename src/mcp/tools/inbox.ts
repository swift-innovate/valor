import {
  getAgent,
  updateHeartbeat,
  getAgentInbox,
} from "../../db/index.js";
import { natsState } from "../../dashboard/nats-state.js";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function handleCheckInbox(
  args: { since?: string; categories?: string[] },
  agentId: string,
): CallToolResult {
  const agent = getAgent(agentId);
  if (!agent) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "Agent not found" }) }],
      isError: true,
    };
  }

  updateHeartbeat(agentId);

  const pendingMissions = natsState.getMissions({
    operative: agent.callsign,
    status: "pending",
  });

  const directives = natsState.drainDirectives(agent.callsign);

  const messages = getAgentInbox(agentId, {
    since: args.since,
  });

  const filtered = args.categories?.length
    ? messages.filter((m) => {
        const cat = (m.payload as Record<string, unknown>).category as string | undefined;
        return cat && args.categories!.includes(cat);
      })
    : messages;

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        heartbeat_at: new Date().toISOString(),
        pending_missions: pendingMissions,
        directives,
        messages: filtered,
      }),
    }],
  };
}
