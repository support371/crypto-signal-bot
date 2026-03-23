import { readJson, writeJson } from "./store.js";

export function createExecutionRouter({ auditStore }) {
  return {
    async route(decisions, settings) {
      const ordersDb = await readJson("orders.json");
      const positionsDb = await readJson("positions.json");
      const created = [];

      for (const decision of decisions.filter((d) => d.approved)) {
        const referencePrice = Number((100 + Math.random() * 50).toFixed(2));
        const quantity = Number((100 / referencePrice).toFixed(4));
        const order = {
          id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          symbol: decision.symbol,
          side: "buy",
          status: "filled",
          exchange: decision.exchange,
          mode: settings.mode || "paper",
          referencePrice,
          quantity,
          createdAt: new Date().toISOString()
        };

        const position = {
          symbol: decision.symbol,
          exchange: decision.exchange,
          size: quantity,
          avgEntry: referencePrice,
          unrealizedPnl: Number(((Math.random() - 0.4) * 12).toFixed(2)),
          openedAt: order.createdAt
        };

        ordersDb.orders.unshift(order);
        positionsDb.positions = positionsDb.positions.filter((p) => p.symbol !== position.symbol);
        positionsDb.positions.unshift(position);
        created.push(order);

        await auditStore.append("orders", order);
        await auditStore.append("fills", { orderId: order.id, symbol: order.symbol, quantity: order.quantity });
      }

      ordersDb.orders = ordersDb.orders.slice(0, 100);
      positionsDb.positions = positionsDb.positions.slice(0, settings.maxOpenPositions || 4);

      await writeJson("orders.json", ordersDb);
      await writeJson("positions.json", positionsDb);

      return { orders: created };
    }
  };
}
