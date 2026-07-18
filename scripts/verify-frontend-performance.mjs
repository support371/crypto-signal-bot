import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const manifestPath = path.join(root, 'dist', '.vite', 'manifest.json')
const appCorePath = path.join(root, 'src', 'AppCore.tsx')
const maxEntryBytes = 300 * 1024
const maxRouteChunkBytes = 600 * 1024

if (!fs.existsSync(manifestPath)) {
  throw new Error('frontend performance verification requires a completed Vite build manifest')
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const records = Object.values(manifest)
const entry = records.find((record) => record && record.isEntry)
if (!entry?.file) throw new Error('Vite manifest does not contain an application entry')

const entryPath = path.join(root, 'dist', entry.file)
const entryBytes = fs.statSync(entryPath).size
if (entryBytes > maxEntryBytes) {
  throw new Error(
    `frontend entry is ${entryBytes} bytes; budget is ${maxEntryBytes} bytes`,
  )
}

const dynamicEntries = records.filter((record) => record?.isDynamicEntry)
if (dynamicEntries.length < 8) {
  throw new Error('frontend routes must remain split into at least eight dynamic entries')
}

for (const record of dynamicEntries) {
  const chunkPath = path.join(root, 'dist', record.file)
  const chunkBytes = fs.statSync(chunkPath).size
  if (chunkBytes > maxRouteChunkBytes) {
    throw new Error(
      `dynamic route chunk ${record.file} is ${chunkBytes} bytes; budget is ${maxRouteChunkBytes} bytes`,
    )
  }
}

const appCore = fs.readFileSync(appCorePath, 'utf8')
if (/^import\s+.*\s+from\s+['"]\.\/pages\//m.test(appCore)) {
  throw new Error('AppCore must not eagerly import route pages')
}
if (!appCore.includes('lazy(() => import(') || !appCore.includes('<Suspense')) {
  throw new Error('AppCore route-level lazy loading contract is missing')
}

console.log(
  `Frontend performance budget passed (entry ${entryBytes} bytes; ${dynamicEntries.length} dynamic entries).`,
)
