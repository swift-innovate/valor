import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { publish } from "../../bus/index.js";
import {
  type DivisionMember,
  DivisionMemberSchema,
  type DivisionRosterEntry,
  DivisionRosterEntrySchema,
  type AgentDivisionEntry,
  AgentDivisionEntrySchema,
} from "../../types/index.js";

function generateId(): string {
  return `dmbr_${nanoid(21)}`;
}

function rowToMember(row: Record<string, unknown>): DivisionMember {
  return DivisionMemberSchema.parse(row);
}

export function addMember(input: {
  division_id: string;
  agent_id: string;
  role: string;
  assigned_by: string;
}): DivisionMember {
  // Lead role must go through transferLead
  if (input.role === "lead") {
    throw new Error("Cannot add member with role 'lead'. Use transferLead.");
  }

  // Validate division exists
  const division = getDb().queryOne("SELECT id FROM divisions WHERE id = @id", { id: input.division_id });
  if (!division) {
    throw new Error(`Division not found: ${input.division_id}`);
  }

  // Validate agent exists
  const agent = getDb().queryOne("SELECT id FROM agents WHERE id = @id", { id: input.agent_id });
  if (!agent) {
    throw new Error(`Agent not found: ${input.agent_id}`);
  }

  const id = generateId();
  const now = new Date().toISOString();

  try {
    getDb().execute(
      `INSERT INTO division_members (id, division_id, agent_id, role, assigned_at, assigned_by)
       VALUES (@id, @division_id, @agent_id, @role, @assigned_at, @assigned_by)`,
      {
        id,
        division_id: input.division_id,
        agent_id: input.agent_id,
        role: input.role,
        assigned_at: now,
        assigned_by: input.assigned_by,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint failed")) {
      throw new Error("Agent is already a member of this division.");
    }
    throw err;
  }

  // Backward compat: if agent's division_id is null, set it
  const agentRow = getDb().queryOne<{ division_id: string | null }>(
    "SELECT division_id FROM agents WHERE id = @id",
    { id: input.agent_id },
  );
  if (agentRow && agentRow.division_id === null) {
    getDb().execute(
      "UPDATE agents SET division_id = @division_id WHERE id = @id",
      { division_id: input.division_id, id: input.agent_id },
    );
  }

  const member = rowToMember(
    getDb().queryOne("SELECT * FROM division_members WHERE id = @id", { id }) as Record<string, unknown>,
  );

  publish({
    type: "division.member.added",
    source: { id: "division-membership", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      division_id: input.division_id,
      agent_id: input.agent_id,
      role: input.role,
      assigned_by: input.assigned_by,
    },
    metadata: null,
  });

  return member;
}

export function removeMember(
  division_id: string,
  agent_id: string,
  removed_by: string,
): boolean {
  const member = getDb().queryOne(
    "SELECT * FROM division_members WHERE division_id = @division_id AND agent_id = @agent_id",
    { division_id, agent_id },
  ) as Record<string, unknown> | null;

  if (!member) return false;

  if (member.role === "lead") {
    throw new Error("Cannot remove division lead. Use transferLead first.");
  }

  getDb().execute(
    "DELETE FROM division_members WHERE division_id = @division_id AND agent_id = @agent_id",
    { division_id, agent_id },
  );

  // Backward compat: if agent's division_id matches this division, set to null
  const agentRow = getDb().queryOne<{ division_id: string | null }>(
    "SELECT division_id FROM agents WHERE id = @id",
    { id: agent_id },
  );
  if (agentRow && agentRow.division_id === division_id) {
    getDb().execute("UPDATE agents SET division_id = NULL WHERE id = @id", { id: agent_id });
  }

  publish({
    type: "division.member.removed",
    source: { id: "division-membership", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: { division_id, agent_id, removed_by },
    metadata: null,
  });

  return true;
}

export function getMember(
  division_id: string,
  agent_id: string,
): DivisionMember | null {
  const row = getDb().queryOne(
    "SELECT * FROM division_members WHERE division_id = @division_id AND agent_id = @agent_id",
    { division_id, agent_id },
  );
  return row ? rowToMember(row as Record<string, unknown>) : null;
}

export function updateMemberRole(
  division_id: string,
  agent_id: string,
  new_role: string,
  changed_by: string,
): DivisionMember | null {
  const member = getMember(division_id, agent_id);
  if (!member) return null;

  if (new_role === "lead") {
    throw new Error("Cannot promote to lead via updateMemberRole. Use transferLead.");
  }

  if (member.role === "lead") {
    throw new Error("Cannot demote lead via updateMemberRole. Use transferLead.");
  }

  getDb().execute(
    "UPDATE division_members SET role = @role WHERE division_id = @division_id AND agent_id = @agent_id",
    { role: new_role, division_id, agent_id },
  );

  publish({
    type: "division.member.role_changed",
    source: { id: "division-membership", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      division_id,
      agent_id,
      old_role: member.role,
      new_role,
      changed_by,
    },
    metadata: null,
  });

  return getMember(division_id, agent_id);
}

export function getRoster(division_id: string): DivisionRosterEntry[] {
  const rows = getDb().queryAll(
    `SELECT dm.*, a.callsign, a.health_status
     FROM division_members dm
     JOIN agents a ON a.id = dm.agent_id
     WHERE dm.division_id = @division_id
     ORDER BY
       CASE dm.role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 WHEN 'operative' THEN 2 END,
       a.callsign`,
    { division_id },
  );
  return rows.map((r) => DivisionRosterEntrySchema.parse(r));
}

export function getAgentDivisions(agent_id: string): AgentDivisionEntry[] {
  const rows = getDb().queryAll(
    `SELECT dm.division_id, d.name AS division_name, d.namespace, dm.role
     FROM division_members dm
     JOIN divisions d ON d.id = dm.division_id
     WHERE dm.agent_id = @agent_id
     ORDER BY d.name`,
    { agent_id },
  );
  return rows.map((r) => AgentDivisionEntrySchema.parse(r));
}

export function getDivisionLead(division_id: string): DivisionMember | null {
  const row = getDb().queryOne(
    "SELECT * FROM division_members WHERE division_id = @division_id AND role = 'lead'",
    { division_id },
  );
  return row ? rowToMember(row as Record<string, unknown>) : null;
}

export function transferLead(
  division_id: string,
  new_lead_agent_id: string,
  transferred_by: string,
): DivisionMember {
  let oldLeadAgentId: string | null = null;

  getDb().transaction(() => {
    // Validate division exists
    const division = getDb().queryOne("SELECT id FROM divisions WHERE id = @id", { id: division_id });
    if (!division) {
      throw new Error(`Division not found: ${division_id}`);
    }

    // Validate new lead agent exists
    const agent = getDb().queryOne("SELECT id FROM agents WHERE id = @id", { id: new_lead_agent_id });
    if (!agent) {
      throw new Error(`Agent not found: ${new_lead_agent_id}`);
    }

    // Find current lead and demote to member
    const currentLead = getDb().queryOne(
      "SELECT * FROM division_members WHERE division_id = @division_id AND role = 'lead'",
      { division_id },
    ) as Record<string, unknown> | null;

    if (currentLead) {
      oldLeadAgentId = currentLead.agent_id as string;
      getDb().execute(
        "UPDATE division_members SET role = 'member' WHERE division_id = @division_id AND agent_id = @agent_id",
        { division_id, agent_id: currentLead.agent_id },
      );
    }

    // Check if new lead is already a member
    const existingMember = getDb().queryOne(
      "SELECT * FROM division_members WHERE division_id = @division_id AND agent_id = @agent_id",
      { division_id, agent_id: new_lead_agent_id },
    );

    if (existingMember) {
      getDb().execute(
        "UPDATE division_members SET role = 'lead' WHERE division_id = @division_id AND agent_id = @agent_id",
        { division_id, agent_id: new_lead_agent_id },
      );
    } else {
      const id = generateId();
      const now = new Date().toISOString();
      getDb().execute(
        `INSERT INTO division_members (id, division_id, agent_id, role, assigned_at, assigned_by)
         VALUES (@id, @division_id, @agent_id, 'lead', @assigned_at, @assigned_by)`,
        { id, division_id, agent_id: new_lead_agent_id, assigned_at: now, assigned_by: transferred_by },
      );
    }

    // Backward compat: update divisions.lead_agent_id
    getDb().execute(
      "UPDATE divisions SET lead_agent_id = @lead WHERE id = @id",
      { lead: new_lead_agent_id, id: division_id },
    );
  });

  publish({
    type: "division.lead.transferred",
    source: { id: "division-membership", type: "system" },
    target: null,
    conversation_id: null,
    in_reply_to: null,
    payload: {
      division_id,
      old_lead_agent_id: oldLeadAgentId,
      new_lead_agent_id,
      transferred_by,
    },
    metadata: null,
  });

  const newLead = getDivisionLead(division_id);
  if (!newLead) {
    throw new Error("transferLead: failed to retrieve new lead after transfer");
  }
  return newLead;
}
