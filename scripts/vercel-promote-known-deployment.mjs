const projectId = 'prj_sdk3k44uV3pCj5p5njSzHzm1vOJX'
const teamId = 'team_7lMXW95WSLeyK4yAObe8FptW'
const deploymentId = 'dpl_H9iqdZY1z2oH7PJVm9mgJyPrNUpg'
const token = process.env.VERCEL_TOKEN ?? process.env.VERCEL_OIDC_TOKEN

if (!token) {
  console.log('One-time Vercel promotion skipped: no build-scoped Vercel token is available.')
  process.exit(0)
}

const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
}

const projectProbe = await fetch(
  `https://api.vercel.com/v9/projects/${projectId}?teamId=${teamId}`,
  { headers },
)

console.log(`One-time Vercel project authorization probe: HTTP ${projectProbe.status}`)

if (!projectProbe.ok) {
  console.log('One-time Vercel promotion skipped because the build-scoped token cannot manage the project.')
  process.exit(0)
}

const response = await fetch(
  `https://api.vercel.com/v10/projects/${projectId}/promote/${deploymentId}?teamId=${teamId}`,
  {
    method: 'POST',
    headers,
  },
)

console.log(`One-time Vercel promotion request: HTTP ${response.status}`)

if (!response.ok) {
  const text = await response.text()
  console.log(`One-time Vercel promotion was not accepted: ${text.slice(0, 240)}`)
}
