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
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-500" />
            <span className="text-muted-foreground">{outcomeA}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500" />
            <span className="text-muted-foreground">{outcomeB}</span>
          </span>
        </div>
        <div className="flex gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                range === r.key
                  ? "bg-teal-500/15 text-teal-400"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="gradA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 14%)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "hsl(220, 10%, 40%)" }}
            axisLine={{ stroke: "hsl(220, 15%, 14%)" }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "hsl(220, 10%, 40%)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(220, 20%, 6%)",
              border: "1px solid hsl(220, 15%, 14%)",
              borderRadius: "4px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "hsl(220, 10%, 55%)" }}
            formatter={((value: number, name: string) => [
              `${value.toFixed(1)}%`,
              name === "outcomeA" ? outcomeA : outcomeB,
            ]) as never}
          />
          <Area
            type="monotone"
            dataKey="outcomeA"
            stroke="#2dd4bf"
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
