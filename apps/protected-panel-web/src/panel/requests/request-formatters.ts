export function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "Pending";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function formatScope(scope: Record<string, unknown> | null) {
  if (!scope) {
    return "Unspecified";
  }

  const parts = Object.entries(scope)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${key}:${value}`);

  return parts.length > 0 ? parts.join(" · ") : "Unspecified";
}
