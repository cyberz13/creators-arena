"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyPoint } from "@/services/analytics";

// CREATORS ARENA identity colors
const PURPLE = "#8B5CF6";
const GRID = "#26262E";
const MUTED = "#71717A";
const AXIS_TICK = { fontSize: 11, fill: "#A1A1AA" };

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#17171C",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 12,
    color: "#FAFAFA",
  },
  labelStyle: { color: "#A1A1AA" },
  itemStyle: { color: "#FAFAFA" },
} as const;

export function DailyVisitsChart({ data }: { data: DailyPoint[] }) {
  if (data.length === 0)
    return <p className="py-10 text-center text-sm text-zinc-500">لا توجد بيانات بعد</p>;
  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="gQualified" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PURPLE} stopOpacity={0.35} />
              <stop offset="100%" stopColor={PURPLE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tick={AXIS_TICK} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={AXIS_TICK} allowDecimals={false} />
          <Tooltip
            {...TOOLTIP_STYLE}
            formatter={(v, name) => [
              String(v ?? 0),
              name === "qualified" ? "مؤهلة" : name === "clicks" ? "إجمالي" : "مرفوضة",
            ]}
          />
          <Area type="monotone" dataKey="clicks" stroke={MUTED} fill="none" strokeWidth={1.5} />
          <Area
            type="monotone"
            dataKey="qualified"
            stroke={PURPLE}
            fill="url(#gQualified)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const SOURCE_COLORS: Record<string, string> = {
  tiktok: "#FAFAFA",
  instagram: "#E1306C",
  snapchat: "#F59E0B",
  direct: PURPLE,
  other: MUTED,
};

const SOURCE_LABELS: Record<string, string> = {
  tiktok: "تيك توك",
  instagram: "إنستقرام",
  snapchat: "سناب شات",
  direct: "مباشر",
  other: "أخرى",
};

export function SourcesChart({ data }: { data: { source: string; count: number }[] }) {
  if (data.length === 0)
    return <p className="py-10 text-center text-sm text-zinc-500">لا توجد بيانات بعد</p>;
  return (
    <div className="flex items-center gap-4">
      <div dir="ltr" className="h-44 w-44 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="source"
              innerRadius={40}
              outerRadius={70}
              paddingAngle={3}
              stroke="#08080A"
            >
              {data.map((d) => (
                <Cell key={d.source} fill={SOURCE_COLORS[d.source] ?? MUTED} />
              ))}
            </Pie>
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(v, n) => [String(v ?? 0), SOURCE_LABELS[String(n)] ?? String(n)]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-sm">
        {data.map((d) => (
          <li key={d.source} className="flex items-center gap-2">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ background: SOURCE_COLORS[d.source] ?? MUTED }}
            />
            <span className="text-zinc-400">{SOURCE_LABELS[d.source] ?? d.source}</span>
            <span className="tabular font-bold text-white">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TopBarChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  if (data.length === 0)
    return <p className="py-10 text-center text-sm text-zinc-500">لا توجد بيانات بعد</p>;
  return (
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={90} tick={AXIS_TICK} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            formatter={(v) => [String(v ?? 0), "زيارة مؤهلة"]}
          />
          <Bar dataKey="value" fill={PURPLE} radius={[0, 6, 6, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
