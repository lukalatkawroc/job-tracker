// scan-gmail / send-digest / generate-cv run with verify_jwt=false (see config.toml)
// because the frontend never authenticates as a real Supabase user — it only holds the
// anon key. That means these URLs are otherwise open to the internet, so gate the
// privileged ones (they read/send from your real mailbox and spend Anthropic credits)
// behind a shared secret the frontend must send as `x-admin-token`.
export function requireAdminToken(req: Request): Response | null {
  const expected = Deno.env.get("ADMIN_TOKEN");
  if (!expected) return null; // not configured yet — allow, so local/dev setup isn't blocked
  const got = req.headers.get("x-admin-token");
  if (got !== expected) {
    return Response.json({ ok: false, error: "Missing or invalid x-admin-token" }, { status: 401 });
  }
  return null;
}

// Non-blocking check, for endpoints (like offer-action) that also accept an unauthenticated
// per-resource token — an admin token is just an alternate way in, not the only one.
export function hasValidAdminToken(req: Request): boolean {
  const expected = Deno.env.get("ADMIN_TOKEN");
  if (!expected) return false;
  return req.headers.get("x-admin-token") === expected;
}
