const TARGET_SUMMARY_LABELS: Record<string, string> = {
  "rag-specialist": "rag agent",
  "navigation-specialist": "navigation agent",
  "campus-services-agent": "campus services agent",
  "notice-agent": "notice agent",
};

export function formatOperatorTargetSummaryLabel(target: string | null): string {
  if (!target) {
    return "unassigned target";
  }

  return TARGET_SUMMARY_LABELS[target] ?? target;
}
