import { Hono } from "hono";
import { requireDirector } from "../auth/index.js";
import {
  createUser,
  getUser,
  listUsers,
  updateUserRole,
  deleteUser,
  deleteUserSessions,
} from "../db/repositories/index.js";

export const userRoutes = new Hono();

// GET /api/users — list all users (director only)
userRoutes.get("/", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;
  return c.json(listUsers());
});

// POST /api/users — create user (director only)
userRoutes.post("/", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  const { username, password, role } = body as Record<string, string>;

  if (!username || !password) {
    return c.json({ error: "username and password are required" }, 400);
  }
  if (!["director", "operator", "observer"].includes(role ?? "")) {
    return c.json({ error: "role must be director, operator, or observer" }, 400);
  }

  try {
    const user = createUser({ username, password, role: role as "director" | "operator" | "observer" });
    return c.json(user, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("already exists")) {
      return c.json({ error: "Username already taken" }, 409);
    }
    return c.json({ error: msg }, 400);
  }
});

// PUT /api/users/:id/role — change role (director only)
userRoutes.put("/:id/role", async (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const body = await c.req.json().catch(() => ({}));
  const { role } = body as Record<string, string>;

  if (!["director", "operator", "observer"].includes(role ?? "")) {
    return c.json({ error: "role must be director, operator, or observer" }, 400);
  }

  const user = updateUserRole(c.req.param("id"), role as "director" | "operator" | "observer");
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(user);
});

// DELETE /api/users/:id — remove user and all their sessions (director only)
userRoutes.delete("/:id", (c) => {
  const denied = requireDirector(c);
  if (denied) return denied;

  const id = c.req.param("id");
  const user = getUser(id);
  if (!user) return c.json({ error: "User not found" }, 404);

  deleteUserSessions(id);
  deleteUser(id);
  return c.json({ ok: true });
});
