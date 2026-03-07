import { z } from "zod";

export const importDashboardSchema = {
  id: z
    .number()
    .describe(
      "Grafana marketplace dashboard ID (from search_marketplace). Example: 1860 for Node Exporter Full."
    ),
  node: z
    .string()
    .optional()
    .describe(
      "Prometheus instance label to substitute for the $node variable. Example: 'localhost:9100'."
    ),
  job: z
    .string()
    .optional()
    .describe(
      "Prometheus job label to substitute for the $job variable. Example: 'node'."
    ),
};

interface RawPanel {
  id: number;
  title: string;
  type: string;
  description?: string;
  targets?: Array<{
    expr?: string;
    legendFormat?: string;
  }>;
  fieldConfig?: {
    defaults?: {
      unit?: string;
      min?: number;
      max?: number;
      thresholds?: {
        steps?: Array<{ value: number | null; color: string }>;
      };
    };
  };
  options?: {
    reduceOptions?: {
      calcs?: string[];
    };
  };
}

interface SlimPanel {
  id: number;
  title: string;
  type: string;
  description?: string;
  queries: string[];
  unit?: string;
  min?: number;
  max?: number;
  thresholds?: Array<{ value: number | null; color: string }>;
}

/**
 * Resolve Grafana template variables to concrete values.
 * Handles the most common variables without requiring a live Grafana instance.
 */
function resolveVariables(
  expr: string,
  vars: { node?: string; job?: string }
): string {
  let resolved = expr;

  // Replace $__rate_interval with a sensible default
  resolved = resolved.replace(/\$__rate_interval/g, "5m");
  resolved = resolved.replace(/\$__interval/g, "1m");
  resolved = resolved.replace(/\$__range/g, "1h");

  // Replace instance/node variables
  if (vars.node) {
    resolved = resolved.replace(/\$node/g, vars.node);
    resolved = resolved.replace(/\$instance/g, vars.node);
  } else {
    // Remove the instance filter so the query still works without it
    resolved = resolved.replace(/,\s*instance="?\$node"?/g, "");
    resolved = resolved.replace(/,\s*instance="?\$instance"?/g, "");
    resolved = resolved.replace(/instance="?\$node"?,?\s*/g, "");
    resolved = resolved.replace(/instance="?\$instance"?,?\s*/g, "");
  }

  // Replace job variables
  if (vars.job) {
    resolved = resolved.replace(/\$job/g, vars.job);
  } else {
    resolved = resolved.replace(/,\s*job="?\$job"?/g, "");
    resolved = resolved.replace(/job="?\$job"?,?\s*/g, "");
  }

  // Clean up any dangling {,} or { }
  resolved = resolved.replace(/\{\s*,\s*/g, "{");
  resolved = resolved.replace(/,\s*\}/g, "}");
  resolved = resolved.replace(/\{\s*\}/g, "");

  return resolved.trim();
}

interface DashboardJson {
  title?: string;
  panels?: RawPanel[];
  rows?: Array<{ panels?: RawPanel[] }>;
}

interface MarketplaceMeta {
  name: string;
  revision: number;
  downloads: number;
  reviewsAvgRating?: number;
  json?: DashboardJson;
}

/**
 * import_dashboard — downloads a dashboard from grafana.com and extracts
 * a token-efficient summary of its panels and PromQL queries.
 *
 * A full dashboard JSON (e.g. Node Exporter Full) is 248KB / ~62K tokens.
 * This tool returns only what the AI needs: panel title, type, PromQL, units.
 * Typical result: ~2.5K tokens (96% compression).
 *
 * Variables like $node, $job, $__rate_interval are resolved to concrete values.
 */
export async function importDashboardHandler(args: {
  id: number;
  node?: string;
  job?: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Step 1: get dashboard metadata — response includes embedded JSON in "json" field
  const metaResp = await fetch(
    `https://grafana.com/api/dashboards/${args.id}`,
    { headers: { Accept: "application/json" } }
  );

  if (!metaResp.ok) {
    return {
      content: [
        {
          type: "text",
          text: `Could not fetch dashboard ${args.id} from Grafana marketplace (HTTP ${metaResp.status}). ` +
                `Make sure the ID is correct — use search_marketplace to find valid IDs.`,
        },
      ],
    };
  }

  const meta = (await metaResp.json()) as MarketplaceMeta;

  // Step 2: get the dashboard panel data.
  // The metadata "json" field embeds the dashboard for smaller dashboards.
  // For larger ones we fall back to downloading the revision.
  let dashJson: DashboardJson;

  const embedded = meta.json;
  if (embedded && typeof embedded === "object" && (embedded.panels || embedded.rows)) {
    dashJson = embedded;
  } else {
    const downloadUrl = `https://grafana.com/api/dashboards/${args.id}/revisions/${meta.revision}/download`;
    const dashResp = await fetch(downloadUrl, {
      headers: { Accept: "application/json" },
    });

    if (!dashResp.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Could not download dashboard JSON (HTTP ${dashResp.status}).`,
          },
        ],
      };
    }

    dashJson = (await dashResp.json()) as DashboardJson;
  }

  // Step 3: collect all panels (handling both flat and row-based layouts)
  let allPanels: RawPanel[] = dashJson.panels ?? [];

  // Old Grafana format uses rows with nested panels
  if (dashJson.rows) {
    for (const row of dashJson.rows) {
      allPanels = allPanels.concat(row.panels ?? []);
    }
  }

  // Filter out rows (type: "row") — they are just separators, not visualizations
  const vizPanels = allPanels.filter((p) => p.type !== "row");

  // Step 4: build slim panel summary
  const slimPanels: SlimPanel[] = [];

  for (const panel of vizPanels) {
    const queries: string[] = [];

    for (const target of panel.targets ?? []) {
      if (target.expr && target.expr.trim()) {
        const resolved = resolveVariables(target.expr, {
          node: args.node,
          job: args.job,
        });
        if (resolved && !queries.includes(resolved)) {
          queries.push(resolved);
        }
      }
    }

    // Only include panels that have actual PromQL queries
    if (queries.length === 0) continue;

    const slim: SlimPanel = {
      id: panel.id,
      title: panel.title,
      type: panel.type,
      queries,
    };

    const defaults = panel.fieldConfig?.defaults;
    if (defaults?.unit) slim.unit = defaults.unit;
    if (defaults?.min !== undefined) slim.min = defaults.min;
    if (defaults?.max !== undefined) slim.max = defaults.max;

    const steps = defaults?.thresholds?.steps;
    if (steps && steps.length > 0) {
      slim.thresholds = steps.filter((s) => s.value !== null);
    }

    if (panel.description) {
      slim.description = panel.description.slice(0, 100);
    }

    slimPanels.push(slim);
  }

  if (slimPanels.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Dashboard "${dashJson.title ?? meta.name}" has no panels with PromQL queries. This dashboard may use a different datasource.`,
        },
      ],
    };
  }

  // Step 5: format the slim output for the AI
  const vars: string[] = [];
  if (args.node) vars.push(`node=${args.node}`);
  if (args.job) vars.push(`job=${args.job}`);
  const varNote = vars.length > 0
    ? `Variables resolved: ${vars.join(", ")}, $__rate_interval=5m`
    : "Variables resolved: $__rate_interval=5m (no node/job filter applied)";

  const lines: string[] = [
    `Dashboard: ${dashJson.title ?? meta.name} (ID: ${args.id})`,
    `Source: grafana.com/dashboards/${args.id} | Downloads: ${(meta.downloads ?? 0).toLocaleString()}`,
    varNote,
    `Panels with queries: ${slimPanels.length}`,
    "",
    "=== PANELS ===",
    "",
  ];

  for (const panel of slimPanels) {
    lines.push(`[${panel.id}] ${panel.title} (type: ${panel.type})`);
    if (panel.description) lines.push(`  Description: ${panel.description}`);
    if (panel.unit) lines.push(`  Unit: ${panel.unit}`);
    if (panel.min !== undefined || panel.max !== undefined) {
      lines.push(`  Range: ${panel.min ?? "auto"} to ${panel.max ?? "auto"}`);
    }
    if (panel.thresholds && panel.thresholds.length > 0) {
      // Skip the null-value base color (index 0 is the default green)
      const threshStr = panel.thresholds
        .filter((t) => t.value !== null)
        .map((t) => `${t.value}=${t.color}`)
        .join(", ");
      if (threshStr) lines.push(`  Thresholds: warn at ${threshStr}`);
    }
    for (const q of panel.queries) {
      lines.push(`  Query: ${q}`);
    }
    lines.push("");
  }

  lines.push(
    "=== NEXT STEP ===",
    "Call render_panel(expr, type) with any query above to visualize live data from Prometheus.",
    "Use the panel type (gauge, timeseries, bargauge, stat) for the best visualization.",
    `Example: render_panel(expr="${slimPanels[0]?.queries[0]?.slice(0, 80)}", type="${slimPanels[0]?.type}", title="${slimPanels[0]?.title}")`
  );

  return { content: [{ type: "text", text: lines.join("\n") }] };
}
