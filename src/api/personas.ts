import { Hono } from "hono";
import {
  createPersona,
  getPersona,
  getPersonaByCallsign,
  listPersonas,
  updatePersona,
  deletePersona,
} from "../db/index.js";
import { loadPersona, parsePersonaDefinition } from "../identity/index.js";

export const personaRoutes = new Hono();

// List personas with optional filters
personaRoutes.get("/", (c) => {
  const division_id = c.req.query("division_id");
  const role = c.req.query("role");
  const active = c.req.query("active");

  const personas = listPersonas({
    division_id,
    role,
    active: active !== undefined ? active === "true" : undefined,
  });
  return c.json(personas);
});

// Get single persona
personaRoutes.get("/:id", (c) => {
  const persona = getPersona(c.req.param("id"));
  if (!persona) return c.json({ error: "Persona not found" }, 404);
  return c.json(persona);
});

// Lookup by callsign
personaRoutes.get("/callsign/:callsign", (c) => {
  const persona = getPersonaByCallsign(c.req.param("callsign"));
  if (!persona) return c.json({ error: "Persona not found" }, 404);
  return c.json(persona);
});

// Create persona directly
personaRoutes.post("/", async (c) => {
  const body = await c.req.json();
  try {
    const persona = createPersona({
      name: body.name,
      callsign: body.callsign,
      role: body.role ?? "operative",
      division_id: body.division_id ?? null,
      ssop_version: body.ssop_version ?? null,
      core_identity: body.core_identity,
      communication_style: body.communication_style,
      decision_framework: body.decision_framework ?? { priorities: [], constraints: [], escalation_triggers: [] },
      knowledge_domains: body.knowledge_domains ?? [],
      operational_constraints: body.operational_constraints ?? [],
      personality_traits: body.personality_traits ?? [],
      active: true,
    });
    return c.json(persona, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Load persona from definition (upsert by callsign)
personaRoutes.post("/load", async (c) => {
  const body = await c.req.json();
  try {
    const definition = parsePersonaDefinition(body);
    const persona = loadPersona(definition);
    return c.json(persona);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

// Update persona
personaRoutes.put("/:id", async (c) => {
  const body = await c.req.json();
  const persona = updatePersona(c.req.param("id"), body);
  if (!persona) return c.json({ error: "Persona not found" }, 404);
  return c.json(persona);
});

// Delete persona
personaRoutes.delete("/:id", (c) => {
  const deleted = deletePersona(c.req.param("id"));
  if (!deleted) return c.json({ error: "Persona not found" }, 404);
  return c.json({ deleted: true });
});
