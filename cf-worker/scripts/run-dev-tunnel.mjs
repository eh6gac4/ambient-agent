#!/usr/bin/env node
// dev 用 cloudflared を connector token で起動
// 使い方: npm run tunnel:dev
// 必要な環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// Token は API から都度取得するためローカル保存しない

import { spawn } from "node:child_process";

const TUNNEL_NAME = "ambient-agent-dev";

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!apiToken || !accountId) {
  console.error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が必要");
  process.exit(1);
}

const cf = (path) =>
  fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  }).then(async (r) => {
    const j = await r.json();
    if (!j.success) throw new Error(`API ${path}: ${JSON.stringify(j.errors)}`);
    return j.result;
  });

const tunnels = await cf(
  `/accounts/${accountId}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false`,
);
const tunnelId = tunnels[0]?.id;
if (!tunnelId) {
  console.error(`tunnel '${TUNNEL_NAME}' が見つからない。先に npm run tunnel:dev:setup を実行`);
  process.exit(1);
}

const token = await cf(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`);
console.log(`tunnel ${tunnelId} を起動中...`);

const child = spawn("cloudflared", ["tunnel", "run", "--token", token], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
