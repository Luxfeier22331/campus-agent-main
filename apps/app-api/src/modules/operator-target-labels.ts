const TARGET_SUMMARY_LABELS: Record<string, string> = {
	"rag-agent": "rag agent",
	"navigation-agent": "navigation agent",
	"campus-services-agent": "campus services agent",
	"notice-agent": "notice agent",
};

export function formatOperatorTargetSummaryLabel(target: string | null): string {
	if (!target) {
		return "unassigned target";
	}

	return TARGET_SUMMARY_LABELS[target] ?? target;
}
