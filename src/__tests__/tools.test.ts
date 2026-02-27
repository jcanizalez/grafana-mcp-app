/**
 * Tool unit tests for grafana-mcp-app.
 *
 * These tests mock the GrafanaClient and verify tool handler behavior
 * without needing a live Grafana instance.
 *
 * Run: npm test
 */
import assert from "node:assert";
import { describe, it, mock } from "node:test";

// ── GrafanaClient Mock ─────────────────────────────────────────────────────

const mockDashboards = [
  { uid: "abc123", title: "Node Metrics", tags: ["node", "infrastructure"], url: "/d/abc123", folderTitle: "Infrastructure" },
  { uid: "def456", title: "API Overview", tags: ["api", "service"], url: "/d/def456" },
  { uid: "ghi789", title: "Kubernetes Cluster", tags: ["kubernetes", "k8s"], url: "/d/ghi789", folderTitle: "K8s" },
];

const mockDashboardDetail = {
  uid: "abc123",
  title: "Node Metrics",
  tags: ["node"],
  schemaVersion: 41,
  url: "/d/abc123",
  panels: [
    { id: 1, title: "CPU Usage", type: "timeseries", gridPos: { x: 0, y: 0, w: 12, h: 8 } },
    { id: 2, title: "Memory Usage", type: "gauge", gridPos: { x: 12, y: 0, w: 12, h: 8 } },
    { id: 3, title: "Disk I/O", type: "timeseries", gridPos: { x: 0, y: 8, w: 24, h: 8 } },
  ],
};

class MockGrafanaClient {
  instanceUrl = "http://localhost:3000";

  async searchDashboards(query: string, tags: string[], limit: number) {
    let results = mockDashboards;
    if (query) {
      results = results.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()));
    }
    if (tags.length > 0) {
      results = results.filter((d) => d.tags.some((t) => tags.includes(t)));
    }
    return results.slice(0, limit);
  }

  async getDashboard(uid: string) {
    if (uid === "abc123") return mockDashboardDetail;
    throw new Error(`Dashboard ${uid} not found`);
  }

  async getAlerts() {
    return [];
  }

  async healthCheck() {
    return { database: "ok", version: "10.0.0" };
  }

  buildPanelEmbedUrl(uid: string, panelId: number, opts: Record<string, string>) {
    const { from = "now-1h", to = "now", theme = "dark" } = opts;
    return `http://localhost:3000/d-solo/${uid}/-?panelId=${panelId}&from=${from}&to=${to}&theme=${theme}`;
  }

  buildDashboardUrl(uid: string) {
    return `http://localhost:3000/d/${uid}/-`;
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("list_dashboards handler", async () => {
  const { listDashboardsHandler } = await import("../tools/list-dashboards.js");
  const client = new MockGrafanaClient() as any;

  it("returns all dashboards when no filters", async () => {
    const result = await listDashboardsHandler({}, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.dashboards.length, 3);
    assert.equal(result.content[0].type, "text");
  });

  it("filters by query string", async () => {
    const result = await listDashboardsHandler({ query: "node" }, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.dashboards.length, 1);
    assert.equal(parsed.dashboards[0].title, "Node Metrics");
  });

  it("filters by tags", async () => {
    const result = await listDashboardsHandler({ tags: ["kubernetes"] }, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.dashboards.length, 1);
    assert.equal(parsed.dashboards[0].uid, "ghi789");
  });

  it("respects limit", async () => {
    const result = await listDashboardsHandler({ limit: 2 }, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.dashboards.length, 2);
  });

  it("includes grafana instance URL in dashboard URLs", async () => {
    const result = await listDashboardsHandler({}, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(parsed.dashboards[0].url.startsWith("http://localhost:3000"));
  });
});

describe("show_panel handler", async () => {
  const { showPanelHandler } = await import("../tools/show-panel.js");
  const client = new MockGrafanaClient() as any;

  it("returns panel data with embed URL", async () => {
    const result = await showPanelHandler({ dashboard_uid: "abc123" }, client);
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.dashboardUid, "abc123");
    assert.equal(parsed.dashboardTitle, "Node Metrics");
    assert.equal(parsed.panelId, 1); // defaults to first panel
    assert.equal(parsed.panelTitle, "CPU Usage");
    assert.ok(parsed.embedUrl.includes("d-solo/abc123"));
    assert.ok(parsed.embedUrl.includes("panelId=1"));
  });

  it("selects specific panel by ID", async () => {
    const result = await showPanelHandler({ dashboard_uid: "abc123", panel_id: 2 }, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.panelId, 2);
    assert.equal(parsed.panelTitle, "Memory Usage");
  });

  it("respects time range parameters", async () => {
    const result = await showPanelHandler({
      dashboard_uid: "abc123",
      from: "now-6h",
      to: "now",
    }, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.deepEqual(parsed.timeRange, { from: "now-6h", to: "now" });
    assert.ok(parsed.embedUrl.includes("from=now-6h"));
  });

  it("includes available panels list", async () => {
    const result = await showPanelHandler({ dashboard_uid: "abc123" }, client);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.availablePanels.length, 3);
    assert.ok(parsed.availablePanels.every((p: {id: number; title: string; type: string}) => p.id && p.title && p.type));
  });

  it("returns error message for dashboard with no panels", async () => {
    const emptyClient = {
      ...client,
      getDashboard: async () => ({ ...mockDashboardDetail, panels: [] }),
    };
    const result = await showPanelHandler({ dashboard_uid: "abc123" }, emptyClient);
    assert.ok(result.content[0].text.includes("no panels"));
  });
});

describe("list_alerts handler", async () => {
  const { listAlertsHandler } = await import("../tools/list-alerts.js");

  it("returns message when no alerts configured", async () => {
    const emptyClient = { getAlerts: async () => [] };
    const result = await listAlertsHandler({}, emptyClient as any);
    assert.ok(result.content[0].text.includes("No alerts found"));
  });

  it("formats firing alerts correctly", async () => {
    const alertClient = {
      getAlerts: async () => [
        {
          uid: "alert1",
          title: "High CPU Usage",
          state: "firing",
          labels: { severity: "critical", service: "api" },
          annotations: { description: "CPU above 90% for 5m" },
        },
      ],
    };
    const result = await listAlertsHandler({}, alertClient as any);
    assert.ok(result.content[0].text.includes("FIRING"));
    assert.ok(result.content[0].text.includes("High CPU Usage"));
    assert.ok(result.content[0].text.includes("CPU above 90%"));
  });
});
