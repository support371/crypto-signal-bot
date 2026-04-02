import { readJson } from "./store.js";

export function createGuardian({ auditStore }) {
  return {
    async review(opportunities, settings) {
      const positions = await readJson("positions.json");
      const state = await readJson("state.json");
      const openCount = positions.positions.length;
      const dailyLimitBreached = (state.metrics.rejections || 0) > 20;

      const decisions = opportunities.map((opportunity) => {
        const approved =
          opportunity.action === "buy" &&
          openCount < settings.maxOpenPositions &&
          !dailyLimitBreached;

        return {
          ...opportunity,
          approved,
          reason: approved
            ? "score and risk checks passed"
            : "guardian blocked due to score or portfolio limits"
        };
      });

      for (const decision of decisions) {
        await auditStore.append("decisions", decision);
      }

      return decisions;
    }
  };
}
