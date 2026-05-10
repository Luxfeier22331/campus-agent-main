interface EditorVendorChunk {
	chunkName: string;
	packageNames?: readonly string[];
	packagePrefixes?: readonly string[];
}

const EDITOR_VENDOR_CHUNKS: readonly EditorVendorChunk[] = [
	{
		chunkName: "vendor-react",
		packageNames: ["react", "react-dom"],
	},
	{
		chunkName: "vendor-editor-codemirror",
		packageNames: ["codemirror"],
		packagePrefixes: ["@codemirror/", "codemirror"],
	},
	{
		chunkName: "vendor-editor-prosemirror",
		packagePrefixes: ["crelt", "orderedmap", "prosemirror-", "rope-sequence", "w3c-keyname"],
	},
];

export function resolvePublicChatManualChunk(id: string): string | undefined {
	const packageName = extractNodeModulePackageName(id);
	if (!packageName) {
		return;
	}
	for (const chunk of EDITOR_VENDOR_CHUNKS) {
		if (chunk.packageNames?.includes(packageName)) {
			return chunk.chunkName;
		}
		if (chunk.packagePrefixes?.some((packagePrefix) => packageName.startsWith(packagePrefix))) {
			return chunk.chunkName;
		}
	}
	return;
}

function extractNodeModulePackageName(id: string): string | undefined {
	const normalized = id.replaceAll("\\", "/");
	const marker = "/node_modules/";
	const markerIndex = normalized.lastIndexOf(marker);
	if (markerIndex === -1) {
		return;
	}
	const segments = normalized.slice(markerIndex + marker.length).split("/");
	if (segments[0]?.startsWith("@")) {
		if (!(segments[0] && segments[1])) {
			return;
		}
		return `${segments[0]}/${segments[1]}`;
	}
	return segments[0];
}
