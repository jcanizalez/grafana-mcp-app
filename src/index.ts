#!/usr/bin/env node
/**
 * grafana-mcp-app — MCP App server for interactive Grafana dashboards.
 *
 * This MCP server connects to a Grafana instance and provides:
 * - list_dashboards: Search and browse available dashboards (with interactive list UI)
 * - show_panel: Render a live Grafana panel as an interactive MCP App (embedded iframe)
 * - query_metrics: Execute PromQL queries via Grafana's datasource proxy
 * - list_alerts: Show active Grafana alert rules
 *
 * Usage:
 *   GRAFANA_URL=http://localhost:3000 GRAFANA_API_KEY=<token> node dist/index.js
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
import { showPanelSchema, showPanelHandler } from "./tools/show-panel.js";
import { queryMetricsSchema, queryMetricsHandler } from "./tools/query-metrics.js";
import { listAlertsSchema, listAlertsHandler } from "./tools/list-alerts.js";

// ── Configuration ──────────────────────────────────────────────────────────

const GRAFANA_URL = process.env.GRAFANA_URL ?? "http://localhost:3000";
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY ?? "";

if (!GRAFANA_API_KEY) {
  console.error(
    "[grafana-mcp-app] Warning: GRAFANA_API_KEY not set. " +
    "Set it to a Grafana service account token for authenticated API access."
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
  version: "0.1.0",
});

const client = new GrafanaClient(GRAFANA_URL, GRAFANA_API_KEY);

// ── Tool: list_dashboards ──────────────────────────────────────────────────

registerAppTool(
  server,
  "list_dashboards",
  {
    description:
      "Search and browse Grafana dashboards. Returns an interactive list UI where you can " +
      "filter by name or tag and click any dashboard to view its panels. " +
      "Use this to discover available dashboards before calling show_panel.",
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

// ── Tool: show_panel ───────────────────────────────────────────────────────

registerAppTool(
  server,
  "show_panel",
  {
    description:
      "Render a live Grafana panel as an interactive visualization inside the conversation. " +
      "The panel loads directly from your Grafana instance with a configurable time range. " +
      "Users can change the time range and refresh the panel without leaving the chat. " +
      "Requires dashboard_uid (from list_dashboards) and optionally a panel_id.",
    _meta: {
      ui: { resourceUri: "ui://grafana/panel-view" },
    },
    inputSchema: showPanelSchema,
  },
  async (args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return showPanelHandler(args as any, client);
  }
);

registerAppResource(
  server,
  "Grafana Panel View",
  "ui://grafana/panel-view",
  {},
  async () => {
    const html = loadUiBundle("panel-view");
    return {
      contents: [{ uri: "ui://grafana/panel-view", text: html, mimeType: "text/html" }],
    };
  }
);

// ── Tool: query_metrics ────────────────────────────────────────────────────

server.tool(
  "query_metrics",
  "Execute a PromQL expression against Grafana's datasource proxy and return the results as text. " +
  "Useful for getting raw metric values for Claude to analyze. For visual output, use show_panel instead. " +
  "Example expressions: 'up', 'rate(http_requests_total[5m])', 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes'.",
  queryMetricsSchema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (args) => queryMetricsHandler(args as any, client)
);

// ── Tool: list_alerts ──────────────────────────────────────────────────────

server.tool(
  "list_alerts",
  "List active Grafana alert rules and their current state (firing, pending, normal). " +
  "Useful for incident response — see which alerts are currently firing before diving into dashboards. " +
  "Filter by state to focus on firing alerts: list_alerts({ state: 'firing' }).",
  listAlertsSchema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (args) => listAlertsHandler(args as any, client)
);

// ── Start ──────────────────────────────────────────────────────────────────

async function main() {
  // Validate Grafana connection on startup
  try {
    const health = await client.healthCheck();
    console.error(`[grafana-mcp-app] Connected to Grafana at ${GRAFANA_URL}`);
    console.error(`[grafana-mcp-app] Database: ${health.database}, Version: ${health.version}`);
  } catch (e) {
    console.error(`[grafana-mcp-app] Warning: Could not reach Grafana at ${GRAFANA_URL}: ${e}`);
    console.error("[grafana-mcp-app] Server will start anyway — Grafana may come up later.");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[grafana-mcp-app] MCP server running on stdio. Ready for connections.");
}

main().catch((e) => {
  console.error("[grafana-mcp-app] Fatal error:", e);
  process.exit(1);
});
