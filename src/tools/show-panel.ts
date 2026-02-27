import { z } from "zod";
import type { GrafanaClient } from "../grafana-client.js";

export const showPanelSchema = {
  dashboard_uid: z
    .string()
    .describe(
      "The UID of the Grafana dashboard (from list_dashboards). Example: 'rYdddlPWk'"
    ),
  panel_id: z
    .number()
    .optional()
    .describe(
      "Specific panel ID to show. If omitted, shows the first panel in the dashboard."
    ),
  from: z
    .string()
    .optional()
    .default("now-1h")
    .describe(
      "Start of the time range. Relative (e.g. 'now-1h', 'now-6h', 'now-24h') or absolute Unix ms."
    ),
  to: z
    .string()
    .optional()
    .default("now")
    .describe("End of the time range. Usually 'now'."),
  theme: z
    .enum(["dark", "light"])
    .optional()
    .default("dark")
    .describe("Grafana panel theme."),
};

export async function showPanelHandler(
  args: {
    dashboard_uid: string;
    panel_id?: number;
    from?: string;
    to?: string;
    theme?: "dark" | "light";
  },
  client: GrafanaClient
) {
  const dashboard = await client.getDashboard(args.dashboard_uid);
  const panels = dashboard.panels ?? [];

  if (panels.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Dashboard "${dashboard.title}" has no panels.`,
        },
      ],
    };
  }

  // Find the requested panel or default to first
  const panel = args.panel_id
    ? (panels.find((p) => p.id === args.panel_id) ?? panels[0])
    : panels[0];

  const from = args.from ?? "now-1h";
  const to = args.to ?? "now";
  const theme = args.theme ?? "dark";

  // Build the embed URL — this will be loaded inside the MCP App iframe
  const embedUrl = client.buildPanelEmbedUrl(args.dashboard_uid, panel.id, {
    from,
    to,
    theme,
  });

  // Payload sent to the UI view via ontoolresult
  const uiPayload = {
    grafanaUrl: client.instanceUrl,
    dashboardUid: args.dashboard_uid,
    dashboardTitle: dashboard.title,
    panelId: panel.id,
    panelTitle: panel.title,
    panelType: panel.type,
    timeRange: { from, to },
    theme,
    embedUrl,
    availablePanels: panels.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
    })),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(uiPayload, null, 2),
      },
    ],
  };
}
