"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import type { ChartDataPoint } from "@/lib/mock-data";

const TIME_RANGES = [
  { key: "1d", label: "1D", slice: 5 },
  { key: "7d", label: "7D", slice: 10 },
  { key: "30d", label: "30D", slice: 20 },
  { key: "all", label: "All", slice: 0 },
] as const;

interface PriceChartProps {
  data: ChartDataPoint[];
  outcomeA: string;
  outcomeB: string;
}

export function PriceChart({ data, outcomeA, outcomeB }: PriceChartProps) {
  const [range, setRange] = useState<string>("all");

  const selectedRange = TIME_RANGES.find((r) => r.key === range)!;
  const chartData = selectedRange.slice > 0
    ? data.slice(-selectedRange.slice)
    : data;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold text-slate-200">
          Implied Probability
        </h3>
        <div className="flex gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                range === r.key
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-slate-200"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="text-slate-400">{outcomeA}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500" />
          <span className="text-slate-400">{outcomeB}</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="gradA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.2} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={{ stroke: "#1e293b" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "#64748b" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={((value: number, name: string) => [
              `${value.toFixed(1)}%`,
              name === "outcomeA" ? outcomeA : outcomeB,
            ]) as never}
          />
          <Area
            type="monotone"
            dataKey="outcomeA"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#gradA)"
          />
          <Area
            type="monotone"
            dataKey="outcomeB"
            stroke="#f43f5e"
            strokeWidth={1.5}
            fill="url(#gradB)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
