const TARGET_SUMMARY_LABELS: Record<string, string> = {
	"knowledge": "rag agent",
	"navigation": "navigation agent",
	"campus_services": "campus services agent",
	"notice": "notice agent",
};

export function formatOperatorTargetSummaryLabel(target: string | null): string {
	if (!target) {
		return "unassigned target";
	}

	return TARGET_SUMMARY_LABELS[target] ?? target;
}
