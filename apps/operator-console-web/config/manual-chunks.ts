const CHUNK_GROUPS = [
	{
		name: "query-form-vendor",
		patterns: ["/node_modules/@tanstack/query-core/", "/node_modules/@tanstack/react-query/"],
	},
	{
		name: "radix-ui-vendor",
		patterns: ["/node_modules/@radix-ui/"],
	},
	{
		name: "react-vendor",
		patterns: [
			"/node_modules/react/",
			"/node_modules/react-dom/",
			"/node_modules/react-router/",
			"/node_modules/react-router-dom/",
			"/node_modules/scheduler/",
		],
	},
] as const;

export function operatorConsoleManualChunks(id: string): string | undefined {
	if (!id.includes("/node_modules/")) {
		return;
	}

	for (const group of CHUNK_GROUPS) {
		if (group.patterns.some((pattern) => id.includes(pattern))) {
			return group.name;
		}
	}

	return;
}
