#!/usr/bin/env node
// dev 用 Cloudflare Named Tunnel + DNS をセットアップする (idempotent)
// 使い方: npm run tunnel:dev:setup
// 必要な環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

const TUNNEL_NAME = "ambient-agent-dev";
const HOSTNAME = "dev-bot.eh6gac4.work";
const ORIGIN_URL = "http://localhost:8787";

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!apiToken || !accountId) {
  console.error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が必要");
  process.exit(1);
}

const cf = (path, init = {}) =>
  fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  }).then(async (r) => {
    const j = await r.json();
    if (!j.success) throw new Error(`API ${path}: ${JSON.stringify(j.errors)}`);
    return j.result;
  });

const zoneName = HOSTNAME.split(".").slice(-2).join(".");
const subdomain = HOSTNAME.replace(`.${zoneName}`, "");

console.log(`zone=${zoneName} subdomain=${subdomain}`);

const zones = await cf(`/zones?name=${zoneName}`);
if (!zones.length) throw new Error(`zone not found: ${zoneName}`);
const zoneId = zones[0].id;

const tunnels = await cf(
  `/accounts/${accountId}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false`,
);
let tunnelId = tunnels[0]?.id;
if (tunnelId) {
  console.log(`tunnel 既存: ${tunnelId}`);
} else {
  const created = await cf(`/accounts/${accountId}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name: TUNNEL_NAME, config_src: "cloudflare" }),
  });
  tunnelId = created.id;
  console.log(`tunnel 作成: ${tunnelId}`);
}

await cf(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
  method: "PUT",
  body: JSON.stringify({
    config: {
      ingress: [
        { hostname: HOSTNAME, service: ORIGIN_URL },
        { service: "http_status:404" },
      ],
    },
  }),
});
console.log(`ingress 設定: ${HOSTNAME} -> ${ORIGIN_URL}`);

const cnameTarget = `${tunnelId}.cfargotunnel.com`;
const records = await cf(`/zones/${zoneId}/dns_records?name=${HOSTNAME}`);
if (records.length) {
  if (records[0].type === "CNAME" && records[0].content === cnameTarget) {
    console.log(`DNS 既存: ${HOSTNAME} -> ${cnameTarget}`);
  } else {
    await cf(`/zones/${zoneId}/dns_records/${records[0].id}`, {
      method: "PUT",
      body: JSON.stringify({
        type: "CNAME",
        name: subdomain,
        content: cnameTarget,
        proxied: true,
      }),
    });
    console.log(`DNS 更新: ${HOSTNAME} -> ${cnameTarget}`);
  }
} else {
  await cf(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: "CNAME",
      name: subdomain,
      content: cnameTarget,
      proxied: true,
    }),
  });
  console.log(`DNS 作成: ${HOSTNAME} -> ${cnameTarget}`);
}

console.log("\nセットアップ完了");
console.log(`Tunnel ID: ${tunnelId}`);
console.log(`Public URL: https://${HOSTNAME}`);
console.log(`次は: npm run tunnel:dev で起動`);
