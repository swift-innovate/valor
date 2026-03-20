import { z } from "zod";

export const PersonaRole = z.enum(["lead", "operative", "analyst", "specialist"]);
export type PersonaRole = z.infer<typeof PersonaRole>;

export const CoreIdentitySchema = z.object({
  mission: z.string().min(1),
  behavioral_directives: z.array(z.string()),
});
export type CoreIdentity = z.infer<typeof CoreIdentitySchema>;

export const CommunicationStyleSchema = z.object({
  tone: z.string().min(1),
  formality: z.enum(["formal", "casual", "adaptive"]),
  patterns: z.array(z.string()),
});
export type CommunicationStyle = z.infer<typeof CommunicationStyleSchema>;

export const DecisionFrameworkSchema = z.object({
  priorities: z.array(z.string()),
  constraints: z.array(z.string()),
  escalation_triggers: z.array(z.string()),
});
export type DecisionFramework = z.infer<typeof DecisionFrameworkSchema>;

export const PersonaSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  callsign: z.string().min(1),
  role: PersonaRole,
  division_id: z.string().nullable(),
  ssop_version: z.string().nullable(),
  core_identity: CoreIdentitySchema,
  communication_style: CommunicationStyleSchema,
  decision_framework: DecisionFrameworkSchema,
  knowledge_domains: z.array(z.string()),
  operational_constraints: z.array(z.string()),
  personality_traits: z.array(z.string()),
  active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Persona = z.infer<typeof PersonaSchema>;
