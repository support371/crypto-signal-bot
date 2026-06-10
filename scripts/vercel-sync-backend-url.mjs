const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const backendUrl = process.env.VERCEL_BACKEND_URL ?? "https://crypto-signal-bot-api.workers.dev";

if (!token || !projectId) {
  throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID secrets are required to update Vercel automatically.");
}

const apiBase = "https://api.vercel.com";
const query = new URLSearchParams(teamId ? { teamId } : {});
const projectPath = `/v9/projects/${projectId}`;
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};

async function vercel(path, init = {}) {
  const response = await fetch(`${apiBase}${path}${query.size ? `?${query}` : ""}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Vercel API ${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return body;
}

const envResponse = await vercel(`${projectPath}/env`);
const existing = envResponse.envs?.filter((env) => env.key === "VITE_BACKEND_URL") ?? [];

for (const env of existing) {
  await vercel(`${projectPath}/env/${env.id}`, { method: "DELETE" });
}

await vercel(`${projectPath}/env`, {
  method: "POST",
  body: JSON.stringify({
    key: "VITE_BACKEND_URL",
    value: backendUrl,
    type: "plain",
    target: ["production", "preview", "development"],
  }),
});

await vercel("/v13/deployments", {
  method: "POST",
  body: JSON.stringify({
    name: "crypto-signal-bot",
    project: projectId,
    target: "production",
    gitSource: {
      type: "github",
      repo: "crypto-signal-bot",
      org: "support371",
      ref: "main",
    },
  }),
});

console.log(`Vercel VITE_BACKEND_URL set to ${backendUrl} and production deployment requested.`);
