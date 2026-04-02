export function createListener({ auditStore }) {
  const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
  const listings = ["NEWT", "ALFA", "ORBX"];

  return {
    async poll(settings) {
      const marketEvents = symbols.map((symbol) => ({
        type: "market",
        symbol,
        movePct: Number(((Math.random() - 0.45) * 6).toFixed(2)),
        volumeSpike: Number((1 + Math.random() * 4).toFixed(2)),
        exchange: settings.primaryExchange || "bitget"
      }));

      const listingEvents = Math.random() > 0.55
        ? [{
            type: "listing",
            symbol: listings[Math.floor(Math.random() * listings.length)],
            expectedLaunchWindow: "24h",
            exchange: settings.secondaryExchange || "btcc",
            socialVelocity: Number((40 + Math.random() * 60).toFixed(2))
          }]
        : [];

      const events = [...marketEvents, ...listingEvents];
      for (const event of events) {
        await auditStore.append("events", event);
      }
      return events;
    }
  };
}
