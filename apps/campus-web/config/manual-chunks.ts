const CHUNK_GROUPS = [
	{
		name: "markdown-vendor",
		patterns: [
			"/node_modules/@assistant-ui/react-markdown/",
			"/node_modules/@types/mdast/",
			"/node_modules/@types/unist/",
			"/node_modules/comma-separated-tokens/",
			"/node_modules/hast-util",
			"/node_modules/mdast-util",
			"/node_modules/micromark",
			"/node_modules/remark-",
			"/node_modules/remark/",
			"/node_modules/space-separated-tokens/",
			"/node_modules/trim-lines/",
			"/node_modules/trough/",
			"/node_modules/unified/",
			"/node_modules/unist-util",
			"/node_modules/vfile",
		],
	},
	{
		name: "assistant-ui-vendor",
		patterns: [
			"/node_modules/@assistant-ui/",
			"/node_modules/assistant-stream/",
			"/node_modules/@assistant-stream/",
		],
	},
	{
		name: "radix-ui-vendor",
		patterns: ["/node_modules/@radix-ui/", "/node_modules/radix-ui/"],
	},
	{
		name: "react-vendor",
		patterns: ["/node_modules/react/", "/node_modules/react-dom/", "/node_modules/scheduler/"],
	},
	{
		name: "state-vendor",
		patterns: ["/node_modules/zustand/"],
	},
] as const;

export function campusWebManualChunks(id: string): string | undefined {
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
