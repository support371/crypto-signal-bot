import { promises as fs } from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'backend/data');

const defaults = {
  'settings.json': {
    mode: 'paper',
    primaryExchange: 'bitget',
    secondaryExchange: 'btcc',
    bitgetApiKey: '',
    bitgetSecret: '',
    bitgetPassphrase: '',
    btccApiKey: '',
    btccSecret: '',
    maxRiskPerTradePct: 2,
    maxDailyLossPct: 5,
    maxOpenPositions: 4,
    updatedAt: null
  },
  'watchlist.json': { opportunities: [] },
  'positions.json': { positions: [] },
  'orders.json': { orders: [] },
  'audit.json': { events: [], scores: [], decisions: [], orders: [], fills: [], settings: [], errors: [] },
  'state.json': {
    lastCycleAt: null,
    metrics: {
      cycles: 0,
      eventsProcessed: 0,
      opportunitiesScored: 0,
      ordersCreated: 0,
      approvals: 0,
      rejections: 0
    },
    settings: null
  }
};

export async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  for (const [name, content] of Object.entries(defaults)) {
    const filePath = path.join(dataDir, name);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(content, null, 2));
    }
  }
}

export async function readJson(name) {
  const raw = await fs.readFile(path.join(dataDir, name), 'utf-8');
  return JSON.parse(raw);
}

export async function writeJson(name, payload) {
  await fs.writeFile(path.join(dataDir, name), JSON.stringify(payload, null, 2));
  return payload;
}
