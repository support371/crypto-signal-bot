const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const backendUrl =
  process.env.VERCEL_BACKEND_URL ??
  "https://crypto-signal-bot-api.analyzer-d94.workers.dev";
const websocketUrl =
  process.env.VERCEL_WS_URL ??
  backendUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
const productionAlias =
  process.env.VERCEL_PRODUCTION_ALIAS ??
  "crypto-signal-bot-indol.vercel.app";

if (!token || !projectId) {
  throw new Error("VERCEL_TOKEN and VERCEL_PROJECT_ID are required to update Vercel automatically.");
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
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { text };
    }
  }
  if (!response.ok) {
    throw new Error(`Vercel API ${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
  }
  return body;
}

async function replaceProjectEnv(key, value) {
  const envResponse = await vercel(`${projectPath}/env`);
  const existing = envResponse.envs?.filter((env) => env.key === key) ?? [];
  for (const env of existing) {
    await vercel(`${projectPath}/env/${env.id}`, { method: "DELETE" });
  }

  await vercel(`${projectPath}/env`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      type: "plain",
      target: ["production", "preview", "development"],
    }),
  });
}

for (const key of ["VITE_BACKEND_URL", "VITE_API_BASE_URL", "VITE_CRYPTOCORE_API_BASE"]) {
  await replaceProjectEnv(key, backendUrl);
}
for (const key of ["VITE_WS_URL", "VITE_WS_BASE_URL"]) {
  await replaceProjectEnv(key, websocketUrl);
}

const deployment = await vercel("/v13/deployments", {
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

if (!deployment.id) {
  throw new Error(`Vercel deployment request did not return an id: ${JSON.stringify(deployment)}`);
}

const terminalFailureStates = new Set(["ERROR", "CANCELED"]);
let readyDeployment = deployment;
for (let attempt = 0; attempt < 120; attempt += 1) {
  readyDeployment = await vercel(`/v13/deployments/${deployment.id}`);
  const state = readyDeployment.readyState ?? readyDeployment.state ?? readyDeployment.status;
  if (state === "READY") break;
  if (terminalFailureStates.has(state)) {
    throw new Error(`Vercel deployment ${deployment.id} entered terminal state ${state}.`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

const finalState = readyDeployment.readyState ?? readyDeployment.state ?? readyDeployment.status;
if (finalState !== "READY") {
  throw new Error(`Timed out waiting for Vercel deployment ${deployment.id}; last state: ${finalState ?? "unknown"}.`);
}

await vercel(`/v10/projects/${projectId}/promote/${deployment.id}`, {
  method: "POST",
});

if (productionAlias) {
  await vercel(`/v2/deployments/${deployment.id}/aliases`, {
    method: "POST",
    body: JSON.stringify({ alias: productionAlias, redirect: null }),
  });
}

console.log(
  `Vercel backend URLs set to ${backendUrl}; deployment ${deployment.id} is READY, promoted, and aliased to ${productionAlias}.`,
);
