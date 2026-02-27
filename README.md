# grafana-mcp-app

> **Grafana dashboards, live inside your AI conversations.**

An [MCP App](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) server that renders interactive Grafana panels directly in Claude, ChatGPT, VS Code, and Goose — no screenshots, no copy-pasting URLs. Just ask, and the dashboard appears.

![Node Overview dashboard rendered in Grafana](./docs/demo.png)

## Why?

Every existing Grafana MCP server returns text or static PNG images. When you're debugging a production incident at 3am, you don't want a number — you want to *see* the spike, zoom in, and change the time range without leaving your conversation.

`grafana-mcp-app` uses the [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) to embed live, interactive Grafana panels in your AI chat window.

## Tools

| Tool | Description | UI? |
|------|-------------|-----|
| `list_dashboards` | Browse available dashboards with search and tag filter | ✅ Interactive grid |
| `show_panel` | Render a live panel with time range controls and refresh | ✅ Embedded iframe |
| `query_metrics` | Run a PromQL query and return results as text | — Text only |
| `list_alerts` | Show active alert rules grouped by state | — Text only |

## Quick Start

### 1. Prerequisites

- Node.js 20+
- A Grafana instance (self-hosted or Grafana Cloud)
- A Grafana [service account token](https://grafana.com/docs/grafana/latest/administration/service-accounts/) with `Viewer` role

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
You: Show me the Node Overview dashboard
Claude: [renders interactive CPU/memory/network panels inline]

You: List all my dashboards
Claude: [shows searchable dashboard grid]

You: What's the current CPU usage?
Claude: [calls query_metrics with node_cpu_seconds_total]
```

## Demo Stack (Docker Compose)

Run a full demo with Grafana + Prometheus + Node Exporter — no Grafana Cloud account needed:

```bash
git clone https://github.com/jcanizalez/grafana-mcp-app
cd grafana-mcp-app
docker-compose up
```

This starts:
- **Grafana** at http://localhost:3000 (admin/admin) — with 2 provisioned dashboards
- **Prometheus** at http://localhost:9090 — scraping Node Exporter
- **Node Exporter** at http://localhost:9100 — real host metrics

Then connect the MCP server (no API key needed for the demo — anonymous access is enabled):

```bash
GRAFANA_URL=http://localhost:3000 npm start
```

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `GRAFANA_URL` | Grafana instance URL | `http://localhost:3000` |
| `GRAFANA_API_KEY` | Service account token | *(empty — anonymous)* |

### Grafana Setup Requirements

Your Grafana instance needs iframe embedding enabled. Add to `grafana.ini`:

```ini
[security]
allow_embedding = true
```

Or with Docker:

```yaml
environment:
  GF_SECURITY_ALLOW_EMBEDDING: "true"
```

### Service Account Permissions

Create a service account with these minimum permissions:

```
dashboards:read
datasources:query
```

## Architecture

```
Claude / ChatGPT / VS Code
         │
         │ MCP (stdio or SSE)
         ▼
  grafana-mcp-app (TypeScript)
  ┌────────────────────────┐
  │ Tools:                 │
  │  list_dashboards ──────┼──→ ui://grafana/dashboard-list
  │  show_panel ───────────┼──→ ui://grafana/panel-view
  │  query_metrics         │
  │  list_alerts           │
  └──────────┬─────────────┘
             │ HTTP API
             ▼
      Grafana Instance
      /api/search
      /api/dashboards/uid/:uid
      /d-solo/:uid (iframe embed)
      /api/ds/query (PromQL)
```

The interactive UI (panel-view, dashboard-list) is served as bundled HTML via `ui://` MCP resources. The AI client renders them in a sandboxed iframe — no external CDN, no build step required for end users.

## Development

```bash
# Install deps
npm install

# Build (TypeScript + copy HTML bundles)
npm run build

# Run tests (12 unit tests, no Grafana needed)
npm test

# Start server
GRAFANA_URL=http://localhost:3000 npm start

# Run integration test client
GRAFANA_URL=http://localhost:3000 node scripts/test-client.js
```

## License

MIT — © 2026 Javier Canizalez

---

*Built with [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps) · Companion article: [Grafana Dashboards Inside Your AI Chat](https://medium.com/@javier-canizalez)*
