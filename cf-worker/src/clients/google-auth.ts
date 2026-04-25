import type { Env } from "../types.js";

const TOKEN_KV_KEY = "google:access_token";

interface TokenCache {
  token: string;
  expiresAt: number;
}

export async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.AGENT_KV.get<TokenCache>(TOKEN_KV_KEY, "json");
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google OAuth refresh failed: ${resp.status} ${body}`);
  }

  const data = await resp.json<{ access_token: string; expires_in: number }>();
  const cache: TokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await env.AGENT_KV.put(TOKEN_KV_KEY, JSON.stringify(cache), {
    expirationTtl: Math.max(data.expires_in - 120, 60),
  });

  return data.access_token;
}
