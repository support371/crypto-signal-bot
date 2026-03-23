import { readJson, writeJson } from './store.js';

export function createAuditStore() {
  return {
    async append(channel, payload) {
      const audit = await readJson('audit.json');
      const entry = {
        id: `${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: new Date().toISOString(),
        ...payload
      };

      if (!Array.isArray(audit[channel])) {
        audit[channel] = [];
      }

      audit[channel].unshift(entry);
      audit[channel] = audit[channel].slice(0, 250);
      await writeJson('audit.json', audit);
      return entry;
    }
  };
}
