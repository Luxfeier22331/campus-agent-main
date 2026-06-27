const TOOL_SUMMARY_LABELS: Record<string, string> = {
	campus_notice_change_set_lookup: "campus notice change-set tool",
	campus_notice_discover: "campus notice discovery tool",
	campus_notice_get: "campus notice detail tool",
	campus_notice_period_summary: "campus notice summary tool",
	knowledge_query: "knowledge tool",
	place_lookup: "place lookup tool",
	transport_schedule_lookup: "transport schedule tool",
};

export function formatOperatorToolSummaryLabel(tool: string | null): string {
	if (!tool) {
		return "unassigned tool";
	}

	return TOOL_SUMMARY_LABELS[tool] ?? tool;
}
