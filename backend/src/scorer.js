import { writeJson } from "./store.js";

export function createScorer({ auditStore }) {
  return {
    async score(events, settings) {
      const opportunities = events.map((event) => {
        const baseScore = event.type === "listing"
          ? 60 + (event.socialVelocity || 0) * 0.3
          : 45 + Math.abs(event.movePct || 0) * 5 + (event.volumeSpike || 0) * 4;

        const score = Math.max(0, Math.min(99, Number(baseScore.toFixed(2))));
        const action = score >= 72 ? "buy" : score >= 58 ? "watch" : "ignore";

        return {
          symbol: event.symbol,
          type: event.type,
          exchange: event.exchange,
          score,
          action,
          maxRiskPct: settings.maxRiskPerTradePct,
          thesis: event.type === "listing"
            ? "pre-listing momentum and launch setup"
            : "intraday momentum and volume expansion"
        };
      });

      for (const item of opportunities) {
        await auditStore.append("scores", item);
      }

      await writeJson("watchlist.json", { opportunities });
      return opportunities;
    }
  };
}
