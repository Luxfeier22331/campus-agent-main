const labels: Record<string, Record<string, string>> = {
	campus: {
		started: "正在检索校内资料",
		completed: "已找到校内资料",
		no_match: "校内检索未找到匹配资料",
		failed: "校内检索失败",
		canceled: "校内检索已取消",
	},
};
export function RetrievalStatus({
	statuses,
}: {
	statuses?: Partial<Record<"campus", string>> | undefined;
}) {
	return (
		<>
			{(["campus"] as const).map((source) => {
				const status = statuses?.[source];
				const label = status && labels[source]?.[status];
				return label ? (
					<span
						key={source}
						className="inline-flex items-center gap-1"
						data-retrieval-source={source}
						data-retrieval-status={status}
					>
						{label}
					</span>
				) : null;
			})}
		</>
	);
}
