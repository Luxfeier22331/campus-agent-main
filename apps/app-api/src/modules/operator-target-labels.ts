const CAPABILITY_SUMMARY_LABELS: Record<string, string> = {
	campus_services: "campus services capability",
	knowledge: "knowledge capability",
	navigation: "navigation capability",
	notice: "notice capability",
};

export function formatOperatorCapabilitySummaryLabel(capability: string | null): string {
	if (!capability) {
		return "unassigned capability";
	}

	return CAPABILITY_SUMMARY_LABELS[capability] ?? capability;
}
