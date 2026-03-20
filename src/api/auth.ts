import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getUserByUsername, verifyPassword } from "../db/repositories/user-repo.js";
import { createSession, deleteSession } from "../db/repositories/session-repo.js";
import { SESSION_COOKIE } from "../auth/index.js";

export const authRoutes = new Hono();

// POST /auth/login — accepts JSON or form data
authRoutes.post("/login", async (c) => {
  let username: string | undefined;
  let password: string | undefined;

  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await c.req.json().catch(() => ({}));
    username = body.username;
    password = body.password;
  } else {
    const form = await c.req.formData().catch(() => new FormData());
    username = form.get("username")?.toString();
    password = form.get("password")?.toString();
  }

  if (!username || !password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const session = createSession(user.id);

  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  if (contentType.includes("application/json")) {
    return c.json({ ok: true, role: user.role, username: user.username });
  }
  return c.redirect("/dashboard");
});

// POST /auth/logout
authRoutes.post("/logout", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });

  const contentType = c.req.header("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return c.json({ ok: true });
  }
  return c.redirect("/login");
});
