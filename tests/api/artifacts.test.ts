import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { freshDb, cleanupDb } from "../helpers/test-db.js";
import { clearSubscriptions, subscribe } from "../../src/bus/event-bus.js";
import { artifactRoutes } from "../../src/api/artifacts.js";
import { commsRoutes } from "../../src/api/comms.js";
import { createAgent } from "../../src/db/repositories/agent-repo.js";
import { createArtifact, getArtifact } from "../../src/db/repositories/artifact-repo.js";
import type { Artifact } from "../../src/types/index.js";
import type { EventEnvelope } from "../../src/types/index.js";

const app = new Hono();
app.route("/artifacts", artifactRoutes);
app.route("/comms", commsRoutes);

beforeEach(() => {
  freshDb();
  clearSubscriptions();
});

afterEach(() => {
  clearSubscriptions();
  cleanupDb();
});

function makeAgent(callsign: string) {
  return createAgent({
    callsign,
    runtime: "claude_api",
    division_id: null,
    endpoint_url: null,
    model: null,
    persona_id: null,
    capabilities: [],
    health_status: "registered",
    last_heartbeat: null,
  });
}

const baseArtifact = {
  title: "example.ts",
  content_type: "code",
  language: "typescript",
  content: "export function hello(): string {\n  return 'world';\n}\n",
  summary: "Simple hello function",
  created_by: "director",
  conversation_id: null,
};

describe("Artifact API", () => {
  describe("POST /artifacts", () => {
    it("creates a code artifact", async () => {
      const res = await app.request("/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseArtifact),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as Artifact;
      expect(data.id).toMatch(/^art_/);
      expect(data.title).toBe("example.ts");
      expect(data.content_type).toBe("code");
      expect(data.language).toBe("typescript");
      expect(data.version).toBe(1);
    });

    it("creates a markdown artifact", async () => {
      const res = await app.request("/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "README.md",
          content_type: "markdown",
          content: "# Hello\n\nThis is a readme.",
          created_by: "director",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as Artifact;
      expect(data.content_type).toBe("markdown");
      expect(data.language).toBeNull();
    });

    it("creates a config artifact", async () => {
      const res = await app.request("/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "docker-compose.yml",
          content_type: "config",
          language: "yaml",
          content: "version: '3'\nservices:\n  app:\n    image: node:20",
          created_by: "director",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json() as Artifact;
      expect(data.content_type).toBe("config");
    });

    it("returns 400 for invalid content_type", async () => {
      const res = await app.request("/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseArtifact, content_type: "binary" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toContain("content_type");
    });

    it("returns 400 if required fields missing", async () => {
      const res = await app.request("/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "test.ts" }), // missing content_type, content, created_by
      });
      expect(res.status).toBe(400);
    });

    it("publishes artifact.created event", async () => {
      const events: EventEnvelope[] = [];
      subscribe("artifact.created", (e) => events.push(e));

      await app.request("/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(baseArtifact),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("artifact.created");
      expect(events[0].payload.title).toBe("example.ts");
      expect(events[0].payload.content_type).toBe("code");
    });
  });

  describe("GET /artifacts/:id", () => {
    it("retrieves artifact by ID", async () => {
      const artifact = createArtifact(baseArtifact);

      const res = await app.request(`/artifacts/${artifact.id}`);
      expect(res.status).toBe(200);
      const data = await res.json() as Artifact;
      expect(data.id).toBe(artifact.id);
      expect(data.content).toBe(baseArtifact.content);
    });

    it("returns 404 for unknown ID", async () => {
      const res = await app.request("/artifacts/art_nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /artifacts/:id", () => {
    it("updates content and bumps version", async () => {
      const artifact = createArtifact(baseArtifact);
      expect(artifact.version).toBe(1);

      const res = await app.request(`/artifacts/${artifact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "export function hello() { return 'updated'; }\n" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as Artifact;
      expect(data.version).toBe(2);
      expect(data.content).toContain("updated");
    });

    it("updates title and summary", async () => {
      const artifact = createArtifact(baseArtifact);

      const res = await app.request(`/artifacts/${artifact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "renamed.ts", summary: "New summary" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as Artifact;
      expect(data.title).toBe("renamed.ts");
      expect(data.summary).toBe("New summary");
      expect(data.version).toBe(2);
    });

    it("publishes artifact.updated event", async () => {
      const events: EventEnvelope[] = [];
      subscribe("artifact.updated", (e) => events.push(e));

      const artifact = createArtifact(baseArtifact);

      await app.request(`/artifacts/${artifact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "changed.ts" }),
      });

      expect(events).toHaveLength(1);
      expect(events[0].payload.version).toBe(2);
    });

    it("returns 404 for unknown artifact", async () => {
      const res = await app.request("/artifacts/art_nonexistent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "test" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /artifacts (list)", () => {
    it("lists all artifacts", async () => {
      createArtifact(baseArtifact);
      createArtifact({ ...baseArtifact, title: "second.ts" });

      const res = await app.request("/artifacts");
      const data = await res.json() as Artifact[];
      expect(data).toHaveLength(2);
    });

    it("filters by created_by", async () => {
      const agent = makeAgent("Gage");
      createArtifact({ ...baseArtifact, created_by: agent.id });
      createArtifact({ ...baseArtifact, title: "director-file.md", created_by: "director" });

      const res = await app.request(`/artifacts?created_by=${agent.id}`);
      const data = await res.json() as Artifact[];
      expect(data).toHaveLength(1);
      expect(data[0].created_by).toBe(agent.id);
    });

    it("filters by content_type", async () => {
      createArtifact(baseArtifact); // code
      createArtifact({ ...baseArtifact, title: "doc.md", content_type: "markdown", language: null });

      const res = await app.request("/artifacts?content_type=markdown");
      const data = await res.json() as Artifact[];
      expect(data).toHaveLength(1);
      expect(data[0].content_type).toBe("markdown");
    });

    it("filters by conversation_id", async () => {
      createArtifact({ ...baseArtifact, conversation_id: "conv_abc" });
      createArtifact({ ...baseArtifact, title: "other.ts", conversation_id: "conv_xyz" });

      const res = await app.request("/artifacts?conversation_id=conv_abc");
      const data = await res.json() as Artifact[];
      expect(data).toHaveLength(1);
      expect(data[0].conversation_id).toBe("conv_abc");
    });
  });

  describe("GET /artifacts/conversation/:id", () => {
    it("returns all artifacts in a conversation", async () => {
      createArtifact({ ...baseArtifact, conversation_id: "conv_test" });
      createArtifact({ ...baseArtifact, title: "second.ts", conversation_id: "conv_test" });
      createArtifact({ ...baseArtifact, title: "other.ts", conversation_id: "conv_other" });

      const res = await app.request("/artifacts/conversation/conv_test");
      const data = await res.json() as Artifact[];
      expect(data).toHaveLength(2);
    });
  });

  describe("DELETE /artifacts/:id", () => {
    it("director can delete an artifact", async () => {
      const artifact = createArtifact(baseArtifact);

      const res = await app.request(`/artifacts/${artifact.id}`, {
        method: "DELETE",
        headers: { "X-VALOR-Role": "director" },
      });

      expect(res.status).toBe(200);
      const data = await res.json() as { deleted: boolean };
      expect(data.deleted).toBe(true);
      expect(getArtifact(artifact.id)).toBeNull();
    });

    it("agent cannot delete (403 without director role)", async () => {
      const artifact = createArtifact(baseArtifact);

      const res = await app.request(`/artifacts/${artifact.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(403);
      expect(getArtifact(artifact.id)).not.toBeNull();
    });

    it("returns 404 for unknown artifact", async () => {
      const res = await app.request("/artifacts/art_nonexistent", {
        method: "DELETE",
        headers: { "X-VALOR-Role": "director" },
      });
      expect(res.status).toBe(404);
    });

    it("publishes artifact.deleted event", async () => {
      const events: EventEnvelope[] = [];
      subscribe("artifact.deleted", (e) => events.push(e));

      const artifact = createArtifact(baseArtifact);
      await app.request(`/artifacts/${artifact.id}`, {
        method: "DELETE",
        headers: { "X-VALOR-Role": "director" },
      });

      expect(events).toHaveLength(1);
      expect(events[0].payload.artifact_id).toBe(artifact.id);
    });
  });
});

describe("Comms: message attachments", () => {
  it("sends a message with a valid artifact attachment", async () => {
    const gage = makeAgent("Gage");
    const mira = makeAgent("Mira");
    const artifact = createArtifact({ ...baseArtifact, created_by: gage.id });

    const res = await app.request("/comms/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_agent_id: gage.id,
        to_agent_id: mira.id,
        subject: "Here's the code",
        body: "Review this please.",
        priority: "routine",
        category: "request",
        conversation_id: "conv_attach_test",
        attachments: [artifact.id],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json() as EventEnvelope;
    expect(data.payload.attachments).toEqual([artifact.id]);
  });

  it("returns 400 for a non-existent attachment ID", async () => {
    const gage = makeAgent("Gage");
    const mira = makeAgent("Mira");

    const res = await app.request("/comms/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_agent_id: gage.id,
        to_agent_id: mira.id,
        subject: "Bad attachment",
        body: "This should fail.",
        priority: "routine",
        category: "advisory",
        conversation_id: "conv_bad_attach",
        attachments: ["art_nonexistent_xyz"],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain("not found");
  });

  it("message with no attachments field defaults to empty array", async () => {
    const gage = makeAgent("Gage");
    const mira = makeAgent("Mira");

    const res = await app.request("/comms/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_agent_id: gage.id,
        to_agent_id: mira.id,
        subject: "Plain message",
        body: "No attachments.",
        priority: "routine",
        category: "advisory",
        conversation_id: "conv_plain",
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json() as EventEnvelope;
    expect(data.payload.attachments).toEqual([]);
  });

  it("can attach multiple artifacts to one message", async () => {
    const gage = makeAgent("Gage");
    const mira = makeAgent("Mira");
    const art1 = createArtifact({ ...baseArtifact, created_by: gage.id });
    const art2 = createArtifact({ ...baseArtifact, title: "second.ts", created_by: gage.id });

    const res = await app.request("/comms/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from_agent_id: gage.id,
        to_agent_id: mira.id,
        subject: "Two files",
        body: "Here are both files.",
        priority: "routine",
        category: "task_handoff",
        conversation_id: "conv_multi",
        attachments: [art1.id, art2.id],
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json() as EventEnvelope;
    expect(data.payload.attachments).toHaveLength(2);
    expect(data.payload.attachments).toContain(art1.id);
    expect(data.payload.attachments).toContain(art2.id);
  });
});
