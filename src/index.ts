#!/usr/bin/env node
/**
 * grafana-mcp-app — MCP App server for AI-driven Grafana dashboard visualization.
 *
 * v2 capabilities:
 * - search_marketplace: Search grafana.com/dashboards (126M+ downloads of community dashboards)
 * - import_dashboard: Download and extract PromQL queries from any marketplace dashboard
 *   (96% token compression vs raw JSON)
 * - render_panel: Render live Chart.js visualizations directly in the AI conversation
 * - query_prometheus: Ad-hoc PromQL queries for analysis
 * - list_dashboards: Browse your own Grafana instance
 * - list_alerts: See active alert rules
 *
 * Usage:
 *   PROMETHEUS_URL=http://localhost:9090 GRAFANA_URL=http://localhost:3000 GRAFANA_API_KEY=<token> node dist/index.js
 *
 * @see https://github.com/jcanizalez/grafana-mcp-app
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAppTool, registerAppResource } from "@modelcontextprotocol/ext-apps/server";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { z } from "zod";

import { GrafanaClient } from "./grafana-client.js";
import { listDashboardsSchema, listDashboardsHandler } from "./tools/list-dashboards.js";
import { queryMetricsSchema, queryMetricsHandler } from "./tools/query-metrics.js";
import { listAlertsSchema, listAlertsHandler } from "./tools/list-alerts.js";
import { searchMarketplaceSchema, searchMarketplaceHandler } from "./tools/search-marketplace.js";
import { importDashboardSchema, importDashboardHandler } from "./tools/import-dashboard.js";
import { renderPanelSchema, renderPanelHandler } from "./tools/render-panel.js";

// ── Configuration ──────────────────────────────────────────────────────────

const GRAFANA_URL = process.env.GRAFANA_URL ?? "http://localhost:3000";
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY ?? "";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL ?? "http://localhost:9090";

if (!GRAFANA_API_KEY) {
  console.error(
    "[grafana-mcp-app] Warning: GRAFANA_API_KEY not set. " +
    "Set it to a Grafana service account token for list_dashboards and list_alerts."
  );
}

// ── UI Bundle Loading ──────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadUiBundle(name: string): string {
  // In production: dist/ui/<name>.html (copied from src/ui/)
  // In dev: src/ui/<name>.html
  const paths = [
    join(__dirname, "ui", `${name}.html`),
    join(__dirname, "..", "src", "ui", `${name}.html`),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return readFileSync(p, "utf-8");
    }
  }

  throw new Error(`UI bundle not found: ${name}.html (searched: ${paths.join(", ")})`);
}

// ── Server Setup ───────────────────────────────────────────────────────────

const server = new McpServer({
  name: "grafana-mcp-app",
  version: "0.2.0",
});

const client = new GrafanaClient(GRAFANA_URL, GRAFANA_API_KEY);

// ── Tool: search_marketplace ───────────────────────────────────────────────
// Search grafana.com/dashboards for community dashboards (no auth needed).

server.tool(
  "search_marketplace",
  "Search the Grafana dashboard marketplace (grafana.com/dashboards). " +
  "Finds community dashboards — 126M+ downloads on top dashboards. " +
  "Use this to discover proven PromQL queries for monitoring your infrastructure. " +
  "Call import_dashboard(id) next to extract the queries from any result.",
  searchMarketplaceSchema,
  async (args) => searchMarketplaceHandler(args as { query: string; datasource?: string; limit?: number })
);

// ── Tool: import_dashboard ─────────────────────────────────────────────────
// Download and extract a slim panel/query summary from a marketplace dashboard.

server.tool(
  "import_dashboard",
  "Download a dashboard from the Grafana marketplace and extract its panels and PromQL queries. " +
  "Returns a token-efficient summary (96% smaller than raw JSON): panel title, type, PromQL expressions, units, and thresholds. " +
  "Variables like $node, $job, and $__rate_interval are resolved to concrete values. " +
  "Call render_panel(expr, type) with any query from the result to visualize live data.",
  importDashboardSchema,
  async (args) => importDashboardHandler(args as { id: number; node?: string; job?: string })
);

// ── Tool: render_panel ─────────────────────────────────────────────────────
// Chart.js visualization, querying Prometheus directly.

registerAppTool(
  server,
  "render_panel",
  {
    description:
      "Render a live Chart.js visualization directly in the AI conversation. " +
      "Queries Prometheus directly for real-time data (no Grafana instance required). " +
      "Supports timeseries (line charts), gauge (current value), stat (single number), and bargauge. " +
      "Get PromQL expressions from import_dashboard() or write your own. " +
      "The panel updates live and the user can change the time range interactively.",
    _meta: {
      ui: { resourceUri: "ui://grafana/panel-render" },
    },
    inputSchema: renderPanelSchema,
  },
  async (args) => {
    return renderPanelHandler(args as {
      expr: string;
      type?: "timeseries" | "gauge" | "stat" | "bargauge";
      title?: string;
      unit?: string;
      min?: number;
      max?: number;
      from?: string;
      to?: string;
    });
  }
);

registerAppResource(
  server,
  "Grafana Panel Renderer",
  "ui://grafana/panel-render",
  {},
  async () => {
    const html = loadUiBundle("panel-render");
    return {
      contents: [{ uri: "ui://grafana/panel-render", text: html, mimeType: "text/html" }],
    };
  }
);

// ── Tool: query_prometheus ─────────────────────────────────────────────────
// Raw PromQL queries against Prometheus for analysis.

server.tool(
  "query_prometheus",
  "Execute a PromQL expression against Prometheus and return the results as text for analysis. " +
  "Use this for ad-hoc metric queries or to understand data before rendering. " +
  "For visual output, use render_panel instead. " +
  "Prometheus URL defaults to " + PROMETHEUS_URL + " (override with PROMETHEUS_URL env var). " +
  "Example expressions: 'up', 'rate(http_requests_total[5m])', 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes'.",
  {
    expr: z
      .string()
      .describe("PromQL expression to query. Example: 'rate(http_requests_total[5m])'"),
    from: z
      .string()
      .optional()
      .default("now-1h")
      .describe("Start of query range. Relative (e.g. 'now-1h') or Unix seconds."),
    to: z
      .string()
      .optional()
      .default("now")
      .describe("End of query range. Usually 'now'."),
  },
  async (args) => {
    // Query Prometheus directly
    function relativeToUnix(rel: string): number {
      const now = Math.floor(Date.now() / 1000);
      if (rel === "now") return now;
      const match = rel.match(/^now-(\d+)([smhd])$/);
      if (!match) return now - 3600;
      const [, amount, unit] = match;
      const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      return now - parseInt(amount) * (multipliers[unit] ?? 60);
    }

    const startTs = relativeToUnix(args.from ?? "now-1h");
    const endTs = relativeToUnix(args.to ?? "now");
    const duration = endTs - startTs;
    const step = Math.max(15, Math.floor(duration / 100));

    const params = new URLSearchParams({
      query: args.expr,
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
        return {
          content: [{
            type: "text" as const,
            text: `Prometheus query failed (HTTP ${resp.status}). Make sure Prometheus is running at ${PROMETHEUS_URL}.`,
          }],
        };
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
        return {
          content: [{ type: "text" as const, text: `Query error: ${data.error ?? "unknown"}` }],
        };
      }

      const results = data.data.result;
      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No data for: ${args.expr}` }],
        };
      }

      const lines: string[] = [
        `PromQL: ${args.expr}`,
        `Range: ${args.from} to ${args.to} | Step: ${step}s`,
        `Series: ${results.length}`,
        "",
      ];

      for (const series of results) {
        const metricName = Object.entries(series.metric)
          .filter(([k]) => k !== "__name__")
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ");
        lines.push(`Series: {${metricName}}`);

        const total = series.values.length;
        const start = Math.max(0, total - 5);
        for (let i = start; i < total; i++) {
          const [t, v] = series.values[i];
          const ts = new Date(t * 1000).toISOString();
          lines.push(`  ${ts}: ${parseFloat(v).toFixed(4)}`);
        }
        if (total > 5) lines.push(`  ... (${total} total points)`);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e}` }],
      };
    }
  }
);

// ── Tool: list_dashboards ──────────────────────────────────────────────────
// Browse your own Grafana instance (kept from v1).

registerAppTool(
  server,
  "list_dashboards",
  {
    description:
      "Search and browse dashboards from your own Grafana instance. Returns an interactive list UI. " +
      "Use search_marketplace instead to find community dashboards from grafana.com.",
    _meta: {
      ui: { resourceUri: "ui://grafana/dashboard-list" },
    },
    inputSchema: listDashboardsSchema,
  },
  async (args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return listDashboardsHandler(args as any, client);
  }
);

registerAppResource(
  server,
  "Grafana Dashboard List",
  "ui://grafana/dashboard-list",
  {},
  async () => {
    const html = loadUiBundle("dashboard-list");
    return {
      contents: [{ uri: "ui://grafana/dashboard-list", text: html, mimeType: "text/html" }],
    };
  }
);

// ── Tool: list_alerts ──────────────────────────────────────────────────────

server.tool(
  "list_alerts",
  "List active alert rules from your Grafana instance and their current state (firing, pending, normal). " +
  "Requires GRAFANA_API_KEY to be set. " +
  "Filter by state to focus on firing alerts: list_alerts({ state: 'firing' }).",
  listAlertsSchema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (args) => listAlertsHandler(args as any, client)
);

// ── Start ──────────────────────────────────────────────────────────────────

async function main() {
  console.error(`[grafana-mcp-app] v0.2.0 starting`);
  console.error(`[grafana-mcp-app] Prometheus: ${PROMETHEUS_URL}`);
  console.error(`[grafana-mcp-app] Grafana: ${GRAFANA_URL}`);

  // Optionally validate Grafana connection (non-fatal)
  if (GRAFANA_API_KEY) {
    try {
      const health = await client.healthCheck();
      console.error(`[grafana-mcp-app] Grafana connected — DB: ${health.database}, Version: ${health.version}`);
    } catch (e) {
      console.error(`[grafana-mcp-app] Warning: Could not reach Grafana at ${GRAFANA_URL}: ${e}`);
      console.error("[grafana-mcp-app] search_marketplace and render_panel work without Grafana.");
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[grafana-mcp-app] MCP server running on stdio. Ready for connections.");
}

main().catch((e) => {
  console.error("[grafana-mcp-app] Fatal error:", e);
  process.exit(1);
});
