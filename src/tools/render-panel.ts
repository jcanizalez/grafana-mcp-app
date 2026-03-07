import { z } from "zod";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:9090";

export const renderPanelSchema = {
  expr: z
    .string()
    .describe(
      "PromQL expression to visualize. Example: '100 * (1 - avg(rate(node_cpu_seconds_total{mode=\"idle\"}[5m])))'"
    ),
  type: z
    .enum(["timeseries", "gauge", "stat", "bargauge"])
    .optional()
    .default("timeseries")
    .describe(
      "Chart type: 'timeseries' (line chart over time), 'gauge' (current value, circular), " +
      "'stat' (single big number), 'bargauge' (horizontal bar). Default: timeseries."
    ),
  title: z
    .string()
    .optional()
    .describe("Panel title shown above the chart. Example: 'CPU Usage %'"),
  unit: z
    .string()
    .optional()
    .describe(
      "Unit for display. Common values: 'percent' (0-100), 'percentunit' (0-1), " +
      "'bytes', 'short', 'ms', 's', 'reqps'. Default: auto."
    ),
  min: z
    .number()
    .optional()
    .describe("Minimum value for gauge/bargauge. Default: 0."),
  max: z
    .number()
    .optional()
    .describe("Maximum value for gauge/bargauge. Default: 100 for percent, auto otherwise."),
  from: z
    .string()
    .optional()
    .default("now-1h")
    .describe("Start of time range. Examples: 'now-15m', 'now-1h', 'now-6h', 'now-24h'. Default: now-1h."),
  to: z
    .string()
    .optional()
    .default("now")
    .describe("End of time range. Usually 'now'."),
};

/**
 * Resolve relative Grafana time (e.g. "now-1h") to Unix seconds.
 */
function relativeToUnix(rel: string): number {
  const now = Math.floor(Date.now() / 1000);
  if (rel === "now") return now;
  const match = rel.match(/^now-(\d+)([smhd])$/);
  if (!match) return now - 3600; // default: 1h ago
  const [, amount, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return now - parseInt(amount) * (multipliers[unit] ?? 60);
}

/**
 * Fetch data from Prometheus for a given PromQL expression and time range.
 * Returns a slim dataset suitable for Chart.js rendering.
 */
async function queryPrometheus(
  expr: string,
  from: string,
  to: string
): Promise<{
  series: Array<{ labels: Record<string, string>; points: Array<[number, number]> }>;
  error?: string;
}> {
  const startTs = relativeToUnix(from);
  const endTs = relativeToUnix(to);
  const duration = endTs - startTs;

  // Choose step based on duration to get ~100 data points
  const step = Math.max(15, Math.floor(duration / 100));

  const params = new URLSearchParams({
    query: expr,
    start: String(startTs),
    end: String(endTs),
    step: String(step),
  });

  try {
    const resp = await fetch(
      `${PROMETHEUS_URL}/api/v1/query_range?${params.toString()}`,
      { headers: { Accept: "application/json" } }
    );

    if (!resp.ok) {
      return { series: [], error: `Prometheus error (HTTP ${resp.status})` };
    }

    const data = (await resp.json()) as {
      status: string;
      error?: string;
      data: {
        resultType: string;
        result: Array<{
          metric: Record<string, string>;
          values: Array<[number, string]>;
        }>;
      };
    };

    if (data.status !== "success") {
      return { series: [], error: data.error ?? "Prometheus query failed" };
    }

    const series = data.data.result.map((r) => ({
      labels: r.metric,
      points: r.values.map(([t, v]) => [t, parseFloat(v)] as [number, number]),
    }));

    return { series };
  } catch (e) {
    return { series: [], error: String(e) };
  }
}

/**
 * render_panel — renders a PromQL query as an interactive Chart.js visualization
 * directly inside the AI conversation.
 *
 * Queries Prometheus directly (no Grafana proxy needed).
 * Returns a UI payload for the MCP App panel-render.html view.
 */
export async function renderPanelHandler(args: {
  expr: string;
  type?: "timeseries" | "gauge" | "stat" | "bargauge";
  title?: string;
  unit?: string;
  min?: number;
  max?: number;
  from?: string;
  to?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const from = args.from ?? "now-1h";
  const to = args.to ?? "now";
  const type = args.type ?? "timeseries";

  // Fetch data from Prometheus
  const { series, error } = await queryPrometheus(args.expr, from, to);

  if (error && series.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: [
            `render_panel failed: ${error}`,
            ``,
            `Expression: ${args.expr}`,
            `Prometheus URL: ${PROMETHEUS_URL}`,
            ``,
            `Make sure Prometheus is running at ${PROMETHEUS_URL}.`,
            `Set PROMETHEUS_URL env var if it is on a different address.`,
          ].join("\n"),
        },
      ],
    };
  }

  // Build the UI payload sent to panel-render.html via ontoolresult
  const payload = {
    __renderPanel: true,
    expr: args.expr,
    title: args.title ?? args.expr.slice(0, 60),
    type,
    unit: args.unit ?? "short",
    min: args.min,
    max: args.max,
    from,
    to,
    prometheusUrl: PROMETHEUS_URL,
    series: series.map((s) => ({
      labels: s.labels,
      // Serialize label name for legend display
      name:
        Object.keys(s.labels).length > 0
          ? Object.entries(s.labels)
              .filter(([k]) => k !== "__name__")
              .map(([k, v]) => `${k}="${v}"`)
              .join(", ") || args.title || "value"
          : args.title ?? "value",
      points: s.points,
    })),
    fetchedAt: new Date().toISOString(),
    dataPoints: series.reduce((sum, s) => sum + s.points.length, 0),
  };

  // Summary for the AI's text context
  const summary: string[] = [
    `Panel rendered: ${payload.title}`,
    `Type: ${type} | Range: ${from} to ${to}`,
    `Expression: ${args.expr}`,
    `Series: ${series.length} | Data points: ${payload.dataPoints}`,
  ];

  if (series.length > 0) {
    // Show the latest value for each series
    summary.push("\nCurrent values:");
    for (const s of series.slice(0, 5)) {
      const last = s.points[s.points.length - 1];
      if (last) {
        const val = last[1];
        const formatted = args.unit?.includes("percent")
          ? `${val.toFixed(1)}%`
          : val.toFixed(2);
        const name =
          Object.keys(s.labels).length > 0
            ? Object.values(s.labels).join(", ")
            : "value";
        summary.push(`  ${name}: ${formatted}`);
      }
    }
    if (series.length > 5) {
      summary.push(`  ... (${series.length - 5} more series)`);
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}
