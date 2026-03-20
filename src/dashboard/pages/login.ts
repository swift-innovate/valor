import { Hono } from "hono";
import { html } from "hono/html";

export const loginPage = new Hono();

loginPage.get("/", (c) => {
  const error = c.req.query("error");

  return c.html(html`<!DOCTYPE html>
<html lang="en" class="h-full bg-gray-950">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — VALOR Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            valor: { 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1' }
          }
        }
      }
    }
  </script>
</head>
<body class="h-full flex items-center justify-center">
  <div class="w-full max-w-sm px-6">
    <div class="text-center mb-8">
      <div class="text-valor-400 font-bold text-3xl tracking-widest mb-2">VALOR</div>
      <div class="text-gray-500 text-sm">Mission Control</div>
    </div>

    ${error ? html`
      <div class="mb-4 px-4 py-3 rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm text-center">
        ${error === "invalid" ? "Invalid username or password." : "Please log in to continue."}
      </div>` : ""}

    <form method="POST" action="/auth/login"
      class="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1.5">Username</label>
        <input
          name="username"
          type="text"
          autocomplete="username"
          autofocus
          required
          class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-valor-500 focus:ring-1 focus:ring-valor-500">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
        <input
          name="password"
          type="password"
          autocomplete="current-password"
          required
          class="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-valor-500 focus:ring-1 focus:ring-valor-500">
      </div>
      <button type="submit"
        class="w-full py-2.5 text-sm font-semibold rounded-lg bg-valor-700 hover:bg-valor-600 text-white transition-colors">
        Sign In
      </button>
    </form>

    <p class="text-center text-xs text-gray-600 mt-4">VALOR Engine — Restricted Access</p>
  </div>
</body>
</html>`);
});
