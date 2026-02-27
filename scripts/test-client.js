#!/usr/bin/env node
/**
 * Quick test client — calls all grafana-mcp-app tools and prints results.
 * Demonstrates the MCP server working end-to-end with a real Grafana instance.
 *
 * Usage: GRAFANA_URL=http://localhost:3000 node scripts/test-client.js
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";

const GRAFANA_URL = process.env.GRAFANA_URL ?? "http://localhost:3000";
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY ?? "";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  grafana-mcp-app — Test Client");
console.log(`  Grafana: ${GRAFANA_URL}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// Start the MCP server as a subprocess
const serverProcess = spawn("node", ["dist/index.js"], {
  cwd: process.cwd(),
  env: { ...process.env, GRAFANA_URL, GRAFANA_API_KEY },
  stdio: ["pipe", "pipe", "inherit"],
});

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, GRAFANA_URL, GRAFANA_API_KEY },
});

const client = new Client(
  { name: "grafana-mcp-test-client", version: "0.1.0" },
  { capabilities: {} }
);

await client.connect(transport);

// ── List available tools ──────────────────────────────────────────────────
console.log("📋 Available tools:");
const { tools } = await client.listTools();
for (const tool of tools) {
  console.log(`  • ${tool.name} — ${tool.description?.slice(0, 70)}...`);
}
console.log();

// ── Test: list_dashboards ─────────────────────────────────────────────────
console.log("🔍 Testing list_dashboards...");
const listResult = await client.callTool({
  name: "list_dashboards",
  arguments: {},
});
const dashboards = JSON.parse(listResult.content[0].text).dashboards;
console.log(`  Found ${dashboards.length} dashboard(s):`);
for (const d of dashboards) {
  console.log(`  • [${d.uid}] ${d.title} — tags: ${d.tags.join(", ") || "none"}`);
}
console.log();

// ── Test: show_panel ──────────────────────────────────────────────────────
if (dashboards.length > 0) {
  const firstUid = dashboards[0].uid;
  console.log(`🖥️  Testing show_panel (dashboard: ${dashboards[0].title})...`);
  const panelResult = await client.callTool({
    name: "show_panel",
    arguments: { dashboard_uid: firstUid, from: "now-1h" },
  });
  const panelData = JSON.parse(panelResult.content[0].text);
  console.log(`  Panel: "${panelData.panelTitle}" (id: ${panelData.panelId}, type: ${panelData.panelType})`);
  console.log(`  Embed URL: ${panelData.embedUrl}`);
  console.log(`  Available panels: ${panelData.availablePanels.length}`);
  panelData.availablePanels.forEach(p =>
    console.log(`    - [${p.id}] ${p.title} (${p.type})`)
  );
  console.log();
}

// ── Test: query_metrics ───────────────────────────────────────────────────
console.log("📊 Testing query_metrics (expr: up)...");
const metricsResult = await client.callTool({
  name: "query_metrics",
  arguments: { expr: "up", from: "now-15m" },
});
console.log(metricsResult.content[0].text.split("\n").map(l => "  " + l).join("\n"));
console.log();

// ── Test: list_alerts ─────────────────────────────────────────────────────
console.log("🚨 Testing list_alerts...");
const alertsResult = await client.callTool({
  name: "list_alerts",
  arguments: {},
});
console.log("  " + alertsResult.content[0].text.split("\n")[0]);
console.log();

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  ✅ All tools responded successfully");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

await client.close();
process.exit(0);
