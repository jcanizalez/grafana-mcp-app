import { z } from "zod";
import type { GrafanaClient } from "../grafana-client.js";

export const queryMetricsSchema = {
  expr: z
    .string()
    .describe(
      "PromQL expression to query. Example: 'rate(http_requests_total[5m])'"
    ),
  from: z
    .string()
    .optional()
    .default("now-1h")
    .describe("Start of query range. Relative (e.g. 'now-1h') or Unix ms."),
  to: z
    .string()
    .optional()
    .default("now")
    .describe("End of query range."),
  datasource_uid: z
    .string()
    .optional()
    .describe(
      "UID of the Prometheus datasource to use. If omitted, uses the default datasource."
    ),
};

/**
 * query_metrics — runs a PromQL expression against Grafana's proxy API.
 *
 * Grafana proxies datasource queries at /api/ds/query, so we never need
 * direct access to Prometheus — authentication stays within Grafana.
 */
export async function queryMetricsHandler(
  args: {
    expr: string;
    from?: string;
    to?: string;
    datasource_uid?: string;
  },
  client: GrafanaClient
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Resolve relative time to Unix seconds
  function relativeToUnix(rel: string): number {
    const now = Math.floor(Date.now() / 1000);
    const match = rel.match(/^now-(\d+)([smhd])$/);
    if (!match) return now;
    const [, amount, unit] = match;
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return now - parseInt(amount) * (multipliers[unit] ?? 60);
  }

  const fromTs = relativeToUnix(args.from ?? "now-1h");
  const toTs = relativeToUnix(args.to ?? "now");

  const body = {
    queries: [
      {
        refId: "A",
        expr: args.expr,
        range: true,
        instant: false,
        ...(args.datasource_uid
          ? { datasource: { uid: args.datasource_uid, type: "prometheus" } }
          : { datasource: { uid: "prometheus-default", type: "prometheus" } }),
      },
    ],
    from: String(fromTs * 1000),
    to: String(toTs * 1000),
  };

  try {
    const baseUrl = client.instanceUrl;
    const response = await fetch(`${baseUrl}/api/ds/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(client as any).token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        content: [
          {
            type: "text",
            text: `Query failed (HTTP ${response.status}): ${text}\n\nExpression: ${args.expr}`,
          },
        ],
      };
    }

    const result = (await response.json()) as {
      results: Record<string, { frames?: Array<{ data?: { values?: number[][] }; schema?: { fields?: Array<{ name: string }> } }> }>;
    };

    // Format result as readable text
    const frames = result?.results?.A?.frames ?? [];
    if (frames.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Query returned no data.\n\nExpression: ${args.expr}\nTime range: ${args.from} → ${args.to}`,
          },
        ],
      };
    }

    const lines: string[] = [
      `PromQL: ${args.expr}`,
      `Range: ${args.from} → ${args.to}`,
      "",
      "Results:",
    ];

    for (const frame of frames) {
      const fields = frame.schema?.fields ?? [];
      const values = frame.data?.values ?? [];
      const timeField = values[0] ?? [];
      const valueField = values[1] ?? [];

      const metricLabels = fields
        .slice(1)
        .map((f) => f.name)
        .join(", ");

      lines.push(`\nSeries: ${metricLabels || "value"}`);

      // Show last 5 data points
      const total = timeField.length;
      const start = Math.max(0, total - 5);
      for (let i = start; i < total; i++) {
        const t = new Date(timeField[i]).toISOString();
        const v = typeof valueField[i] === "number"
          ? valueField[i].toFixed(4)
          : valueField[i];
        lines.push(`  ${t}: ${v}`);
      }

      if (total > 5) {
        lines.push(`  ... (${total} total data points)`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Error querying metrics: ${e}\n\nExpression: ${args.expr}`,
        },
      ],
    };
  }
}
