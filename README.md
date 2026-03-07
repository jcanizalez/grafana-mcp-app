# grafana-mcp-app

> **Community dashboard intelligence, rendered live inside your AI conversations.**

An [MCP App](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) server that renders interactive Chart.js visualizations directly in Claude, ChatGPT, VS Code, and Goose — grounded in the 126M+ downloads of community dashboards on the Grafana marketplace.

## Why?

The Grafana marketplace has the best PromQL queries in the world. Engineers have spent years tuning the CPU, memory, and disk metrics in the Node Exporter Full dashboard (126M downloads, 4.9 stars). Why write your own from scratch?

With `grafana-mcp-app v2`, your AI can:

1. Search the marketplace for relevant dashboards
2. Extract the exact PromQL queries from community dashboards (96% token compression vs raw JSON)
3. Render them as live Chart.js panels directly in your AI chat

No Grafana instance required for the core workflow. Just Prometheus.

## Tools

| Tool | Description | UI? |
|------|-------------|-----|
| `search_marketplace` | Search grafana.com/dashboards (126M+ community downloads, no auth) | — Text |
| `import_dashboard` | Extract PromQL queries from any marketplace dashboard (96% compression) | — Text |
| `render_panel` | Render live Chart.js charts directly in the conversation | Chart.js UI |
| `query_prometheus` | Ad-hoc PromQL queries for analysis | — Text |
| `list_dashboards` | Browse dashboards on your own Grafana instance | Interactive UI |
| `list_alerts` | Show active alert rules from Grafana | — Text |

## Quick Start

### 1. Prerequisites

- Node.js 20+
- Prometheus (for `render_panel` — to serve live metric data)
- Optional: A Grafana instance with a service account token (for `list_dashboards`, `list_alerts`)

### 2. Install

```bash
npm install -g grafana-mcp-app
```

Or run directly with npx:

```bash
npx grafana-mcp-app
```

### 3. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "grafana": {
      "command": "npx",
      "args": ["grafana-mcp-app"],
      "env": {
        "PROMETHEUS_URL": "http://localhost:9090",
        "GRAFANA_URL": "http://localhost:3000",
        "GRAFANA_API_KEY": "your-service-account-token"
      }
    }
  }
}
```

Restart Claude Desktop. You'll see the Grafana tools in the tool list.

### 4. Use It

```
You: I want to monitor my Node Exporter
Claude: search_marketplace("node exporter")
Claude: → Found Node Exporter Full (ID: 1860, 126M downloads, 4.9 stars)
Claude: import_dashboard(1860, job="node")
Claude: → Extracted 15 panels with PromQL (CPU gauge, RAM gauge, disk, network...)
Claude: render_panel(expr="100 * (1 - avg(rate(...)))", type="gauge", title="CPU Usage")
Claude: [live Chart.js gauge appears in your chat]
```

## Demo Stack (Docker Compose)

Run a full demo with Prometheus + Node Exporter + Grafana — no cloud account needed:

```bash
git clone https://github.com/jcanizalez/grafana-mcp-app
cd grafana-mcp-app
docker-compose up
```

This starts:
- **Prometheus** at http://localhost:9090 — scraping Node Exporter
- **Node Exporter** at http://localhost:9100 — real host metrics
- **Grafana** at http://localhost:3000 (admin/admin) — optional, for list_dashboards

Then connect the MCP server:

```bash
PROMETHEUS_URL=http://localhost:9090 GRAFANA_URL=http://localhost:3000 npm start
```

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `PROMETHEUS_URL` | Prometheus instance URL | `http://localhost:9090` |
| `GRAFANA_URL` | Grafana instance URL (optional) | `http://localhost:3000` |
| `GRAFANA_API_KEY` | Service account token (optional) | *(empty)* |

## Architecture

```
Claude / ChatGPT / VS Code
         │
         │ MCP (stdio or SSE)
         ▼
  grafana-mcp-app v2 (TypeScript)
  ┌──────────────────────────────────────┐
  │ search_marketplace ──────────────────┼──→ grafana.com/api/dashboards
  │ import_dashboard ────────────────────┼──→ grafana.com (download + extract)
  │ render_panel ────────────────────────┼──→ ui://grafana/panel-render (Chart.js)
  │                                      │         │
  │ query_prometheus ────────────────────┼──→ Prometheus /api/v1/query_range
  │ list_dashboards ─────────────────────┼──→ Grafana /api/search
  │ list_alerts ─────────────────────────┼──→ Grafana /api/v1/alerts
  └──────────────────────────────────────┘
```

The `render_panel` tool queries Prometheus directly for live data, then renders a Chart.js visualization as a bundled MCP App HTML resource — no Grafana proxy needed.

`import_dashboard` compresses dashboard JSON by 96% (248KB Node Exporter Full becomes ~2.7K tokens) by extracting only panel title, type, PromQL expressions, units, and thresholds.

## Development

```bash
# Install deps
npm install

# Build (TypeScript + copy HTML bundles)
npm run build

# Run tests (12 unit tests, no Prometheus or Grafana needed)
npm test

# Start server
PROMETHEUS_URL=http://localhost:9090 GRAFANA_URL=http://localhost:3000 npm start
```

## License

MIT — © 2026 Javier Canizalez

---

*Built with [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps) · Companion article: [Live Grafana Dashboards in Your AI Chat](https://medium.com/@javier-canizalez)*
