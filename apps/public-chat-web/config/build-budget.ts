export interface PublicChatBuildAsset {
	fileName: string;
	byteLength: number;
}

export interface PublicChatBuildBudgetResult {
	checkedEditorChunkCount: number;
	ok: true;
}

const DEFAULT_MAX_EDITOR_VENDOR_CHUNK_BYTES = 600_000;
const DEFAULT_MAX_TEXT_EDITOR_CHUNK_BYTES = 180_000;

const EDITOR_ONLY_PRELOAD_PATTERNS = [
	"vendor-editor-table",
	"vendor-editor-codemirror",
	"vendor-editor-prosemirror",
	"text-editor",
	"sheet-editor",
] as const;

export function checkPublicChatBuildBudgetSnapshot(input: {
	assets: PublicChatBuildAsset[];
	indexHtml: string;
	maxEditorVendorChunkBytes?: number;
	maxTextEditorChunkBytes?: number;
}): PublicChatBuildBudgetResult {
	const preloadedEditorChunk = EDITOR_ONLY_PRELOAD_PATTERNS.find((pattern) =>
		input.indexHtml.includes(pattern),
	);
	if (preloadedEditorChunk) {
		throw new Error(
			`public chat app shell must not preload editor-only chunk: ${preloadedEditorChunk}`,
		);
	}

	let checkedEditorChunkCount = 0;
	for (const asset of input.assets) {
		const budget = resolveEditorChunkBudget({
			fileName: asset.fileName,
			maxEditorVendorChunkBytes:
				input.maxEditorVendorChunkBytes ?? DEFAULT_MAX_EDITOR_VENDOR_CHUNK_BYTES,
			maxTextEditorChunkBytes: input.maxTextEditorChunkBytes ?? DEFAULT_MAX_TEXT_EDITOR_CHUNK_BYTES,
		});
		if (budget === undefined) {
			continue;
		}
		checkedEditorChunkCount += 1;
		if (asset.byteLength > budget) {
			throw new Error(
				`public chat editor chunk exceeds budget: ${asset.fileName} (${asset.byteLength} > ${budget})`,
			);
		}
	}

	return {
		checkedEditorChunkCount,
		ok: true,
	};
}

function resolveEditorChunkBudget(input: {
	fileName: string;
	maxEditorVendorChunkBytes: number;
	maxTextEditorChunkBytes: number;
}): number | undefined {
	if (input.fileName.includes("text-editor")) {
		return input.maxTextEditorChunkBytes;
	}
	if (input.fileName.includes("sheet-editor")) {
		return input.maxTextEditorChunkBytes;
	}
	if (
		input.fileName.includes("vendor-editor-codemirror") ||
		input.fileName.includes("vendor-editor-prosemirror") ||
		input.fileName.includes("vendor-editor-table")
	) {
		return input.maxEditorVendorChunkBytes;
	}
	return;
}
