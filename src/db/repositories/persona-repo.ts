import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import { type Persona, PersonaSchema } from "../../types/index.js";

function generateId(): string {
  return `per_${nanoid(21)}`;
}

function rowToPersona(row: Record<string, unknown>): Persona {
  return PersonaSchema.parse({
    ...row,
    core_identity: JSON.parse(row.core_identity as string),
    communication_style: JSON.parse(row.communication_style as string),
    decision_framework: JSON.parse(row.decision_framework as string),
    knowledge_domains: JSON.parse(row.knowledge_domains as string),
    operational_constraints: JSON.parse(row.operational_constraints as string),
    personality_traits: JSON.parse(row.personality_traits as string),
    active: row.active === 1,
  });
}

export function createPersona(
  input: Omit<Persona, "id" | "created_at" | "updated_at">,
): Persona {
  const now = new Date().toISOString();
  const id = generateId();

  getDb()
    .prepare(
      `INSERT INTO personas (id, name, callsign, role, division_id, ssop_version,
       core_identity, communication_style, decision_framework,
       knowledge_domains, operational_constraints, personality_traits,
       active, created_at, updated_at)
       VALUES (@id, @name, @callsign, @role, @division_id, @ssop_version,
       @core_identity, @communication_style, @decision_framework,
       @knowledge_domains, @operational_constraints, @personality_traits,
       @active, @created_at, @updated_at)`,
    )
    .run({
      id,
      name: input.name,
      callsign: input.callsign,
      role: input.role,
      division_id: input.division_id,
      ssop_version: input.ssop_version,
      core_identity: JSON.stringify(input.core_identity),
      communication_style: JSON.stringify(input.communication_style),
      decision_framework: JSON.stringify(input.decision_framework),
      knowledge_domains: JSON.stringify(input.knowledge_domains),
      operational_constraints: JSON.stringify(input.operational_constraints),
      personality_traits: JSON.stringify(input.personality_traits),
      active: input.active ? 1 : 0,
      created_at: now,
      updated_at: now,
    });

  return PersonaSchema.parse({ ...input, id, created_at: now, updated_at: now });
}

export function getPersona(id: string): Persona | null {
  const row = getDb().prepare("SELECT * FROM personas WHERE id = @id").get({ id });
  return row ? rowToPersona(row as Record<string, unknown>) : null;
}

export function getPersonaByCallsign(callsign: string): Persona | null {
  const row = getDb()
    .prepare("SELECT * FROM personas WHERE callsign = @callsign AND active = 1")
    .get({ callsign });
  return row ? rowToPersona(row as Record<string, unknown>) : null;
}

export function listPersonas(filters?: {
  division_id?: string;
  role?: string;
  active?: boolean;
}): Persona[] {
  let sql = "SELECT * FROM personas";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.division_id) {
    conditions.push("division_id = @division_id");
    params.division_id = filters.division_id;
  }
  if (filters?.role) {
    conditions.push("role = @role");
    params.role = filters.role;
  }
  if (filters?.active !== undefined) {
    conditions.push("active = @active");
    params.active = filters.active ? 1 : 0;
  }

  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY name";

  const rows = getDb().prepare(sql).all(params);
  return rows.map((r) => rowToPersona(r as Record<string, unknown>));
}

export function updatePersona(
  id: string,
  updates: Partial<Omit<Persona, "id" | "created_at" | "updated_at">>,
): Persona | null {
  const existing = getPersona(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const merged = { ...existing, ...updates, updated_at: now };

  getDb()
    .prepare(
      `UPDATE personas SET name = @name, callsign = @callsign, role = @role,
       division_id = @division_id, ssop_version = @ssop_version,
       core_identity = @core_identity, communication_style = @communication_style,
       decision_framework = @decision_framework, knowledge_domains = @knowledge_domains,
       operational_constraints = @operational_constraints, personality_traits = @personality_traits,
       active = @active, updated_at = @updated_at WHERE id = @id`,
    )
    .run({
      id,
      name: merged.name,
      callsign: merged.callsign,
      role: merged.role,
      division_id: merged.division_id,
      ssop_version: merged.ssop_version,
      core_identity: JSON.stringify(merged.core_identity),
      communication_style: JSON.stringify(merged.communication_style),
      decision_framework: JSON.stringify(merged.decision_framework),
      knowledge_domains: JSON.stringify(merged.knowledge_domains),
      operational_constraints: JSON.stringify(merged.operational_constraints),
      personality_traits: JSON.stringify(merged.personality_traits),
      active: merged.active ? 1 : 0,
      updated_at: now,
    });

  return PersonaSchema.parse(merged);
}

export function deletePersona(id: string): boolean {
  const result = getDb().prepare("DELETE FROM personas WHERE id = @id").run({ id });
  return result.changes > 0;
}
