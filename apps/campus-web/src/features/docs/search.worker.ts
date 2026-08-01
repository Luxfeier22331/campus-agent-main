import { createDocsSearchEngine, readDocsSearchIndex, searchDocsEngine } from "./search";
import type {
	DocsSearchDocumentGroup,
	DocsSearchWorkerRequest,
	DocsSearchWorkerResponse,
} from "./search-client";

const INITIAL_VISIBLE_SECTIONS = 3;

interface DocsSearchWorkerScope {
	onmessage: ((event: MessageEvent<DocsSearchWorkerRequest>) => void) | null;
	postMessage(message: DocsSearchWorkerResponse): void;
}

const scope = globalThis as unknown as DocsSearchWorkerScope;
let engine: ReturnType<typeof createDocsSearchEngine> | null = null;
let initializedKey: string | null = null;

scope.onmessage = (event) => {
	void handleMessage(event.data);
};

async function handleMessage(message: DocsSearchWorkerRequest): Promise<void> {
	if (message.type === "initialize") {
		try {
			if (initializedKey && initializedKey !== message.key) {
				throw new Error("docs search worker cannot change index");
			}
			initializedKey = message.key;
			const index = await readDocsSearchIndex(message.searchIndexUrl);
			engine = createDocsSearchEngine([index], message.siteIndex);
			scope.postMessage({ type: "ready" });
		} catch (error) {
			scope.postMessage({ message: errorMessage(error), type: "error" });
		}
		return;
	}
	if (!engine) {
		scope.postMessage({
			message: "docs search worker is not ready",
			requestId: message.requestId,
			type: "error",
		});
		return;
	}
	try {
		const groups = groupSearchResults(searchDocsEngine(message.query, engine));
		if (message.type === "search") {
			const documentGroups = groups
				.slice(message.documentOffset, message.documentOffset + message.documentLimit)
				.map((group) => toDocumentGroup(group, INITIAL_VISIBLE_SECTIONS));
			scope.postMessage({
				documentOffset: message.documentOffset,
				documentGroups,
				requestId: message.requestId,
				totalDocumentCount: groups.length,
				type: "results",
			});
			return;
		}
		const group = groups.find((candidate) => candidate.document.docId === message.docId);
		if (!group) {
			throw new Error(`docs search result document is missing: ${message.docId}`);
		}
		scope.postMessage({
			documentGroup: toDocumentGroup(group),
			requestId: message.requestId,
			type: "document",
		});
	} catch (error) {
		scope.postMessage({
			message: errorMessage(error),
			requestId: message.requestId,
			type: "error",
		});
	}
}

function groupSearchResults(results: ReturnType<typeof searchDocsEngine>): Array<{
	document: ReturnType<typeof searchDocsEngine>[number]["document"];
	results: ReturnType<typeof searchDocsEngine>;
}> {
	const groups = new Map<
		string,
		{
			document: ReturnType<typeof searchDocsEngine>[number]["document"];
			results: ReturnType<typeof searchDocsEngine>;
		}
	>();
	for (const result of results) {
		const existing = groups.get(result.document.docId);
		if (existing) {
			existing.results.push(result);
		} else {
			groups.set(result.document.docId, {
				document: result.document,
				results: [result],
			});
		}
	}
	return [...groups.values()];
}

function toDocumentGroup(
	group: ReturnType<typeof groupSearchResults>[number],
	sectionLimit?: number,
): DocsSearchDocumentGroup {
	return {
		document: group.document,
		isComplete: sectionLimit === undefined || group.results.length <= sectionLimit,
		results: sectionLimit === undefined ? group.results : group.results.slice(0, sectionLimit),
		totalSectionCount: group.results.length,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
