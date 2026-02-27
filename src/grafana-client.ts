/**
 * Grafana HTTP API client.
 *
 * Handles authentication via service account token and provides
 * typed methods for the Grafana HTTP API endpoints we use.
 */

export interface GrafanaDashboard {
  uid: string;
  title: string;
  url: string;
  tags: string[];
  folderTitle?: string;
  type: string;
}

export interface GrafanaDashboardPanel {
  id: number;
  title: string;
  type: string;
  description?: string;
  gridPos: { x: number; y: number; w: number; h: number };
}

export interface GrafanaDashboardDetail {
  uid: string;
  title: string;
  tags: string[];
  panels: GrafanaDashboardPanel[];
  url: string;
  schemaVersion: number;
}

export interface GrafanaAlert {
  uid: string;
  title: string;
  state: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export class GrafanaClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    // Normalize: strip trailing slash
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `Grafana API error ${response.status} for ${path}: ${text}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Search for dashboards by query string and optional tags.
   */
  async searchDashboards(
    query: string = "",
    tags: string[] = [],
    limit: number = 20
  ): Promise<GrafanaDashboard[]> {
    const params = new URLSearchParams({
      type: "dash-db",
      limit: String(limit),
    });
    if (query) params.set("query", query);
    if (tags.length > 0) params.set("tag", tags.join(","));

    return this.fetch<GrafanaDashboard[]>(`/api/search?${params.toString()}`);
  }

  /**
   * Get full dashboard detail including panels list.
   */
  async getDashboard(uid: string): Promise<GrafanaDashboardDetail> {
    const response = await this.fetch<{ dashboard: GrafanaDashboardDetail }>(
      `/api/dashboards/uid/${uid}`
    );
    return response.dashboard;
  }

  /**
   * Get active Grafana alerts (requires Grafana Alerting).
   */
  async getAlerts(state?: string): Promise<GrafanaAlert[]> {
    const params = new URLSearchParams();
    if (state) params.set("state", state);

    try {
      return await this.fetch<GrafanaAlert[]>(
        `/api/v1/alerts?${params.toString()}`
      );
    } catch {
      // Alerting may not be configured — return empty array
      return [];
    }
  }

  /**
   * Test the connection and return Grafana version info.
   */
  async healthCheck(): Promise<{ database: string; version: string }> {
    return this.fetch<{ database: string; version: string }>("/api/health");
  }

  /**
   * Build the embedded panel iframe URL for a given dashboard and panel.
   * This URL can be used in an iframe that displays the live panel.
   */
  buildPanelEmbedUrl(
    dashboardUid: string,
    panelId: number,
    options: {
      from?: string;
      to?: string;
      theme?: "dark" | "light";
      width?: number;
      height?: number;
    } = {}
  ): string {
    const {
      from = "now-1h",
      to = "now",
      theme = "dark",
    } = options;

    const params = new URLSearchParams({
      panelId: String(panelId),
      orgId: "1",
      from,
      to,
      theme,
    });

    return `${this.baseUrl}/d-solo/${dashboardUid}/-?${params.toString()}`;
  }

  /**
   * Build the full dashboard URL for embedding or deep-linking.
   */
  buildDashboardUrl(
    dashboardUid: string,
    options: { from?: string; to?: string; theme?: "dark" | "light" } = {}
  ): string {
    const { from = "now-1h", to = "now", theme = "dark" } = options;
    const params = new URLSearchParams({ from, to, theme });
    return `${this.baseUrl}/d/${dashboardUid}/-?${params.toString()}`;
  }

  get instanceUrl(): string {
    return this.baseUrl;
  }
}
