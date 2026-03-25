import { publish } from "../../bus/event-bus.js";

type CallToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function handleAcknowledgeDirective(
  args: {
    directive_type: string;
    mission_id: string;
    acknowledged: boolean;
    note?: string;
  },
  agentId: string,
): CallToolResult {
  if (!args.directive_type) return err("directive_type is required");
  if (!args.mission_id) return err("mission_id is required");
  if (typeof args.acknowledged !== "boolean") return err("acknowledged must be a boolean");

  publish({
    type: "directive.acknowledged",
    source: { id: agentId, type: "agent" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      directive_type: args.directive_type,
      mission_id: args.mission_id,
      acknowledged: args.acknowledged,
      note: args.note ?? null,
    },
    metadata: null,
  });

  return ok({
    acknowledged: args.acknowledged,
    directive_type: args.directive_type,
    mission_id: args.mission_id,
  });
}
