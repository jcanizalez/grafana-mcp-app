import { z } from "zod";
import type { GrafanaClient } from "../grafana-client.js";

export const listDashboardsSchema = {
  query: z
    .string()
    .optional()
    .describe("Search query to filter dashboards by title (optional)"),
  tags: z
    .array(z.string())
    .optional()
    .describe("Filter by tags (e.g. ['kubernetes', 'node'])"),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Maximum number of dashboards to return (default: 20)"),
};

export async function listDashboardsHandler(
  args: { query?: string; tags?: string[]; limit?: number },
  client: GrafanaClient
) {
  const dashboards = await client.searchDashboards(
    args.query ?? "",
    args.tags ?? [],
    args.limit ?? 20
  );

  // Return a compact representation for both text and UI consumption
  const summary = dashboards.map((d) => ({
    uid: d.uid,
    title: d.title,
    tags: d.tags,
    folderTitle: d.folderTitle,
    url: `${client.instanceUrl}${d.url}`,
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ dashboards: summary }, null, 2),
      },
    ],
  };
}
