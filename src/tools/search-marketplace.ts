import { z } from "zod";

export const searchMarketplaceSchema = {
  query: z
    .string()
    .describe(
      "Search term to find dashboards. Examples: 'node exporter', 'kubernetes', 'postgres', 'nginx'."
    ),
  datasource: z
    .enum(["prometheus", "loki", "influxdb", "elasticsearch", "graphite"])
    .optional()
    .describe(
      "Filter by datasource type. Omit to search across all datasources."
    ),
  limit: z
    .number()
    .optional()
    .default(5)
    .describe("Number of results to return (default 5, max 20)."),
};

interface MarketplaceDashboard {
  id: number;
  name: string;
  description: string;
  slug: string;
  downloads: number;
  reviewsCount: number;
  reviewsAvgRating: number;
  datasource: string;
  updatedAt: string;
}

/**
 * search_marketplace — finds dashboards on grafana.com/dashboards.
 *
 * Uses the public Grafana marketplace API (no auth required).
 * Returns a slim list of results so the AI can pick the best match
 * before calling import_dashboard.
 */
export async function searchMarketplaceHandler(args: {
  query: string;
  datasource?: string;
  limit?: number;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const limit = Math.min(args.limit ?? 5, 20);

  const params = new URLSearchParams({
    orderBy: "downloads",
    direction: "desc",
    pageSize: String(limit),
    filter: args.query,
  });

  try {
    const resp = await fetch(
      `https://grafana.com/api/dashboards?${params.toString()}`,
      {
        headers: { Accept: "application/json" },
      }
    );

    if (!resp.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Marketplace search failed (HTTP ${resp.status}). Try a different query.`,
          },
        ],
      };
    }

    const data = (await resp.json()) as { items: MarketplaceDashboard[]; total: number };
    let items = data.items ?? [];

    // Filter by datasource if specified
    if (args.datasource) {
      const ds = args.datasource.toLowerCase();
      items = items.filter((item) =>
        item.datasource?.toLowerCase().includes(ds)
      );
    }

    if (items.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No dashboards found for "${args.query}"${args.datasource ? ` with datasource: ${args.datasource}` : ""}. Try broader search terms.`,
          },
        ],
      };
    }

    const lines: string[] = [
      `Grafana Marketplace — "${args.query}" (${data.total} total, showing top ${items.length}):`,
      "",
    ];

    for (const item of items) {
      const rating = item.reviewsAvgRating
        ? `${item.reviewsAvgRating.toFixed(1)}/5 (${item.reviewsCount} reviews)`
        : "no ratings";
      const downloads = (item.downloads ?? 0).toLocaleString();
      const updated = item.updatedAt
        ? new Date(item.updatedAt).getFullYear()
        : "?";

      lines.push(
        `[${item.id}] ${item.name}`,
        `  Datasource: ${item.datasource || "unknown"} | Downloads: ${downloads} | Rating: ${rating} | Updated: ${updated}`,
        item.description ? `  ${item.description.slice(0, 120)}` : "",
        `  Import with: import_dashboard(${item.id})`,
        ""
      );
    }

    lines.push(
      `Tip: Call import_dashboard(id) to extract panel queries from any of these dashboards,`,
      `then call render_panel(expr, type) to visualize live data from Prometheus.`
    );

    return { content: [{ type: "text", text: lines.join("\n") }] };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: `Error searching marketplace: ${e}`,
        },
      ],
    };
  }
}
