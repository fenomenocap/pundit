"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import type { MarketResponse } from "@/lib/api";

interface OrdersPanelProps {
  market: MarketResponse;
}

interface MockOrder {
  id: string;
  side: "buy" | "sell";
  outcome: string;
  type: "market" | "limit";
  price: number;
  quantity: number;
  filled: number;
  status: "open" | "filled" | "cancelled";
  timestamp: string;
}

function generateMockOrders(market: MarketResponse): MockOrder[] {
  const now = Date.now();
  return [
    {
      id: "ord-001",
      side: "buy",
      outcome: market.outcomeA,
      type: "limit",
      price: 32,
      quantity: 50,
      filled: 0,
      status: "open",
      timestamp: new Date(now - 120_000).toISOString(),
    },
    {
      id: "ord-002",
      side: "buy",
      outcome: market.outcomeA,
      type: "market",
      price: 35,
      quantity: 25,
      filled: 25,
      status: "filled",
      timestamp: new Date(now - 3_600_000).toISOString(),
    },
    {
      id: "ord-003",
      side: "sell",
      outcome: market.outcomeB,
      type: "limit",
      price: 68,
      quantity: 15,
      filled: 15,
      status: "filled",
      timestamp: new Date(now - 7_200_000).toISOString(),
    },
    {
      id: "ord-004",
      side: "buy",
      outcome: market.outcomeA,
      type: "limit",
      price: 28,
      quantity: 100,
      filled: 0,
      status: "cancelled",
      timestamp: new Date(now - 14_400_000).toISOString(),
    },
  ];
}

export function OrdersPanel({ market }: OrdersPanelProps) {
  const [tab, setTab] = useState<"open" | "history">("open");
  const { isConnected } = useAccount();

  const orders = generateMockOrders(market);
  const openOrders = orders.filter((o) => o.status === "open");
  const historyOrders = orders.filter((o) => o.status !== "open");

  const displayOrders = tab === "open" ? openOrders : historyOrders;

  return (
    <div className="flex h-full flex-col border-t border-border bg-card">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border">
        {(["open", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-[11px] font-semibold transition-all capitalize",
              tab === t
                ? "text-foreground border-b-2 border-cyan-400"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "open" ? `Open Orders (${openOrders.length})` : "Order History"}
          </button>
        ))}
      </div>

      {/* Orders table */}
      <div className="flex-1 overflow-auto">
        {!isConnected ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Connect wallet to view orders
          </div>
        ) : displayOrders.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {tab === "open" ? "No open orders" : "No order history"}
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Side</th>
                <th className="px-3 py-2 text-left font-medium">Outcome</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Filled</th>
                {tab === "history" && (
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                )}
                <th className="px-3 py-2 text-right font-medium">Time</th>
                {tab === "open" && (
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayOrders.map((order) => (
                <tr key={order.id} className="border-b border-border/50 hover:bg-secondary/30">
                  <td className={cn(
                    "px-3 py-1.5 font-medium",
                    order.side === "buy" ? "text-cyan-400" : "text-pink-400"
                  )}>
                    {order.side.toUpperCase()}
                  </td>
                  <td className="px-3 py-1.5 text-foreground">{order.outcome}</td>
                  <td className="px-3 py-1.5 text-muted-foreground capitalize">{order.type}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-foreground">
                    {order.price}&cent;
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-foreground">
                    {order.quantity}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                    {order.filled}/{order.quantity}
                  </td>
                  {tab === "history" && (
                    <td className={cn(
                      "px-3 py-1.5 text-right text-[10px] font-medium",
                      order.status === "filled" ? "text-cyan-400" : "text-muted-foreground"
                    )}>
                      {order.status.toUpperCase()}
                    </td>
                  )}
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {new Date(order.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </td>
                  {tab === "open" && (
                    <td className="px-3 py-1.5 text-right">
                      <button className="rounded px-2 py-0.5 text-[10px] font-medium text-pink-400 hover:bg-pink-500/10 transition-colors">
                        Cancel
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
