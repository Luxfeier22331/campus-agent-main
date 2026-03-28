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

export function formatStatusLabel(status: string) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "completed":
      return "Completed";
    case "needs_clarification":
      return "Needs clarification";
    case "no_answer":
      return "No answer";
    case "error":
      return "Error";
    default:
      return status;
  }
}

export function formatSurfaceLabel(surface: string) {
  if (surface === "public_chat_web") {
    return "Public chat web";
  }
  if (surface === "protected_panel_web") {
    return "Protected panel web";
  }

  return surface
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatTimestamp(value: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
