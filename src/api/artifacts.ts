import { Hono, type Context } from "hono";
import {
  createArtifact,
  getArtifact,
  updateArtifact,
  listArtifacts,
  listArtifactsByConversation,
  deleteArtifact,
} from "../db/repositories/artifact-repo.js";
import { ArtifactType } from "../types/index.js";

export const artifactRoutes = new Hono();

function requireDirector(c: Context): Response | null {
  const role = c.req.header("X-VALOR-Role");
  if (role !== "director" && role !== "system") {
    return c.json({ error: "Only the Director can delete artifacts" }, 403) as unknown as Response;
  }
  return null;
}

// List artifacts (filterable by ?created_by=&conversation_id=&content_type=)
artifactRoutes.get("/", (c) => {
  const created_by = c.req.query("created_by") || undefined;
  const conversation_id = c.req.query("conversation_id") || undefined;
  const content_type = c.req.query("content_type") || undefined;
  const artifacts = listArtifacts({ created_by, conversation_id, content_type });
  return c.json(artifacts);
});

// Get artifacts by conversation
artifactRoutes.get("/conversation/:conversationId", (c) => {
  const artifacts = listArtifactsByConversation(c.req.param("conversationId"));
  return c.json(artifacts);
});

// Get single artifact
artifactRoutes.get("/:id", (c) => {
  const artifact = getArtifact(c.req.param("id"));
  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  return c.json(artifact);
});

// Create artifact
artifactRoutes.post("/", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.title) return c.json({ error: "title is required" }, 400);
  if (!body.content_type) return c.json({ error: "content_type is required" }, 400);
  if (!body.content) return c.json({ error: "content is required" }, 400);
  if (!body.created_by) return c.json({ error: "created_by is required" }, 400);

  const typeResult = ArtifactType.safeParse(body.content_type);
  if (!typeResult.success) {
    return c.json({ error: `Invalid content_type. Must be one of: ${ArtifactType.options.join(", ")}` }, 400);
  }

  try {
    const artifact = createArtifact({
      title: body.title as string,
      content_type: body.content_type as string,
      language: (body.language as string | null | undefined) ?? null,
      content: body.content as string,
      summary: (body.summary as string | null | undefined) ?? null,
      created_by: body.created_by as string,
      conversation_id: (body.conversation_id as string | null | undefined) ?? null,
    });
    return c.json(artifact, 201);
  } catch (err: unknown) {
    return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 400);
  }
});

// Update artifact (bumps version)
artifactRoutes.put("/:id", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const artifact = updateArtifact(c.req.param("id"), {
    title: body.title as string | undefined,
    content: body.content as string | undefined,
    summary: body.summary as string | null | undefined,
    language: body.language as string | null | undefined,
  });

  if (!artifact) return c.json({ error: "Artifact not found" }, 404);
  return c.json(artifact);
});

// Delete artifact (Director only)
artifactRoutes.delete("/:id", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const deleted = deleteArtifact(c.req.param("id"));
  if (!deleted) return c.json({ error: "Artifact not found" }, 404);
  return c.json({ deleted: true });
});
