import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { getSession } from "../db/repositories/session-repo.js";
import { getUser, type User } from "../db/repositories/user-repo.js";
import { logger } from "../utils/logger.js";

export const SESSION_COOKIE = "valor_session";

/** Retrieve the authenticated user from context (set by authMiddleware). */
export function getAuthUser(c: Context): User | null {
  return (c.get("authUser") as User) ?? null;
}

/**
 * Resolve the effective role for a request.
 * Human users authenticated via session cookie take precedence.
 * Agents use X-VALOR-Role + X-VALOR-Agent-Key headers.
 *
 * When VALOR_AGENT_KEY env var is set (production mode), the agent must
 * provide a matching X-VALOR-Agent-Key header alongside X-VALOR-Role.
 * When VALOR_AGENT_KEY is not set (dev mode), the header fallback is
 * allowed with a warning.
 */
export function getRequestRole(c: Context): string | null {
  const user = getAuthUser(c);
  if (user) return user.role;

  const headerRole = c.req.header("X-VALOR-Role");
  if (!headerRole) return null;

  const configuredKey = process.env.VALOR_AGENT_KEY;
  if (configuredKey) {
    // Production mode: require matching agent key
    const providedKey = c.req.header("X-VALOR-Agent-Key");
    if (providedKey !== configuredKey) {
      logger.warn("X-VALOR-Role header rejected: invalid or missing X-VALOR-Agent-Key", {
        attempted_role: headerRole,
      });
      return null;
    }
    return headerRole;
  }

  // Dev mode: allow header fallback but warn
  logger.warn("X-VALOR-Role header accepted without agent key (dev mode — set VALOR_AGENT_KEY to enforce)", {
    role: headerRole,
  });
  return headerRole;
}

/**
 * Shared requireDirector guard — checks session role OR X-VALOR-Role header.
 * Returns a Response to reject, or null to allow.
 */
export function requireDirector(c: Context): Response | null {
  const role = getRequestRole(c);
  if (role !== "director" && role !== "system") {
    return c.json({ error: "Only the Director can perform this action" }, 403) as unknown as Response;
  }
  return null;
}

/**
 * App-level middleware: validates the session cookie and attaches the user
 * to context as "authUser". Passes through even if no session exists
 * (individual routes or dashboard middleware enforce auth).
 */
export async function sessionMiddleware(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = getSession(token);
    if (session) {
      const user = getUser(session.user_id);
      if (user) {
        c.set("authUser", user);
      }
    }
  }
  await next();
}

/**
 * Dashboard middleware: requires a valid session. Redirects to /login if not authenticated.
 */
export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const user = getAuthUser(c);
  if (!user) {
    return c.redirect("/login");
  }
  await next();
}

/**
 * Dashboard middleware: requires director role. Returns 403 otherwise.
 */
export async function requireDirectorSession(c: Context, next: Next): Promise<Response | void> {
  const user = getAuthUser(c);
  if (!user || user.role !== "director") {
    return c.redirect("/dashboard");
  }
  await next();
}
