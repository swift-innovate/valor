import {
  sendMessage,
  generateConversationId,
} from "../../db/index.js";

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

export function handleSendMessage(
  args: {
    to_agent_id?: string;
    to_division_id?: string;
    subject?: string;
    body: string;
    priority?: string;
    conversation_id?: string;
    category?: string;
  },
  agentId: string,
): CallToolResult {
  if (!args.body) return err("body is required");
  if (!args.to_agent_id && !args.to_division_id) {
    return err("Either to_agent_id or to_division_id is required");
  }

  const conversationId = args.conversation_id || generateConversationId();

  try {
    const event = sendMessage({
      from_agent_id: agentId,
      to_agent_id: args.to_agent_id ?? null,
      to_division_id: args.to_division_id ?? null,
      subject: args.subject ?? "",
      body: args.body,
      priority: (args.priority as "routine" | "priority" | "flash") ?? "routine",
      conversation_id: conversationId,
      in_reply_to: null,
      category: (args.category as "task_handoff" | "status_update" | "request" | "response" | "escalation" | "advisory" | "coordination") ?? "coordination",
      attachments: [],
    });

    return ok({
      message_id: event.id,
      conversation_id: event.conversation_id,
      delivered: true,
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
