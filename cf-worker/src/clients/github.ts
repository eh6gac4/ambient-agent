import type { Env } from "../types.js";

export async function createIssue(env: Env, title: string, body: string): Promise<string | null> {
  if (!env.GITHUB_PAT || !env.GITHUB_REPO) {
    console.warn("createIssue: GITHUB_PAT or GITHUB_REPO is not set");
    return null;
  }

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/issues`;
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": `token ${env.GITHUB_PAT}`,
        "User-Agent": "Ambient-Agent/1.0"
      },
      body: JSON.stringify({ title, body })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`createIssue: Failed to create issue: ${res.status} ${errorText}`);
      return null;
    }

    const data = await res.json() as any;
    return data.html_url;
  } catch (err) {
    console.error("createIssue: Exception", err);
    return null;
  }
}
