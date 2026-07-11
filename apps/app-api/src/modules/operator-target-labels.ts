const TOOL_SUMMARY_LABELS: Record<string, string> = {
	knowledge_query: "knowledge tool",
	transport_schedule_lookup: "transport schedule tool",
};

const TOOL_DOMAIN_BUCKETS: Record<string, string> = {
	knowledge: "knowledge",
	knowledge_query: "knowledge",
	transport_schedule_lookup: "campus_services",
};

export function formatOperatorToolSummaryLabel(tool: string | null): string {
	if (!tool) {
		return "unassigned tool";
	}

	return TOOL_SUMMARY_LABELS[tool] ?? tool;
}

export function formatOperatorToolDomainBucket(tool: string | null | undefined): string | null {
	const normalized = tool?.trim();
	if (!normalized) {
		return null;
	}

	return TOOL_DOMAIN_BUCKETS[normalized] ?? normalized;
}
