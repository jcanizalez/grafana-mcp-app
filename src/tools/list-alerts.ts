import { z } from "zod";
import type { GrafanaClient } from "../grafana-client.js";

export const listAlertsSchema = {
  state: z
    .enum(["pending", "firing", "inactive", "normal"])
    .optional()
    .describe(
      "Filter alerts by state. Options: 'pending', 'firing', 'inactive', 'normal'. Omit for all alerts."
    ),
};

export async function listAlertsHandler(
  args: { state?: "pending" | "firing" | "inactive" | "normal" },
  client: GrafanaClient
) {
  const alerts = await client.getAlerts(args.state);

  if (alerts.length === 0) {
    const stateMsg = args.state ? ` in state "${args.state}"` : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `No alerts found${stateMsg}. Your Grafana instance may not have alerting configured, or all rules are in a normal state.`,
        },
      ],
    };
  }

  // Group by state
  const byState = alerts.reduce(
    (acc, alert) => {
      const s = alert.state ?? "unknown";
      if (!acc[s]) acc[s] = [];
      acc[s].push(alert);
      return acc;
    },
    {} as Record<string, typeof alerts>
  );

  const lines: string[] = ["## Active Grafana Alerts", ""];

  const stateEmoji: Record<string, string> = {
    firing: "🔴",
    pending: "🟡",
    inactive: "⚪",
    normal: "🟢",
    unknown: "❓",
  };

  for (const [state, stateAlerts] of Object.entries(byState)) {
    const emoji = stateEmoji[state] ?? "❓";
    lines.push(`### ${emoji} ${state.toUpperCase()} (${stateAlerts.length})`);
    for (const alert of stateAlerts) {
      lines.push(`- **${alert.title}**`);
      if (alert.annotations?.description) {
        lines.push(`  ${alert.annotations.description}`);
      }
      if (Object.keys(alert.labels).length > 0) {
        const labelStr = Object.entries(alert.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(", ");
        lines.push(`  Labels: \`${labelStr}\``);
      }
    }
    lines.push("");
  }

  lines.push(`_Total: ${alerts.length} alert rule${alerts.length !== 1 ? "s" : ""}_`);

  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
  };
}
