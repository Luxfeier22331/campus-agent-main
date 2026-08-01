import type { DocsSearchResult } from "./search";
import type { DocsSiteIndex } from "./site-index";

export interface DocsSearchDocumentGroup {
	document: DocsSearchResult["document"];
	isComplete: boolean;
	results: DocsSearchResult[];
	totalSectionCount: number;
}

export interface DocsSearchPage {
	documentGroups: DocsSearchDocumentGroup[];
	documentOffset: number;
	totalDocumentCount: number;
}

type DocsSearchWorkerOperation =
	| {
			documentLimit: number;
			documentOffset: number;
			query: string;
			type: "search";
	  }
	| { docId: string; query: string; type: "expand" };

export type DocsSearchWorkerRequest =
	| {
			key: string;
			searchIndexUrl: string;
			siteIndex: DocsSiteIndex;
			type: "initialize";
	  }
	| (DocsSearchWorkerOperation & { requestId: number });

export type DocsSearchWorkerResponse =
	| { type: "ready" }
	| { message: string; requestId?: number; type: "error" }
	| {
			documentOffset: number;
			documentGroups: DocsSearchDocumentGroup[];
			requestId: number;
			totalDocumentCount: number;
			type: "results";
	  }
	| { documentGroup: DocsSearchDocumentGroup; requestId: number; type: "document" };

interface SearchWorker {
	addEventListener(type: "error", listener: () => void): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<DocsSearchWorkerResponse>) => void,
	): void;
	postMessage(message: DocsSearchWorkerRequest): void;
}

export interface DocsSearchClient {
	expand(query: string, docId: string): Promise<DocsSearchDocumentGroup>;
	ready(): Promise<void>;
	search(input: {
		documentLimit: number;
		documentOffset: number;
		query: string;
	}): Promise<DocsSearchPage>;
}

const clients = new Map<string, DocsSearchClient>();

export function loadDocsSearchClient(input: {
	searchIndexUrl: string;
	siteIndex: DocsSiteIndex;
}): DocsSearchClient {
	const key = input.searchIndexUrl;
	const existing = clients.get(key);
	if (existing) {
		return existing;
	}
	const client = createDocsSearchClient(
		input,
		key,
		() =>
			new Worker(new URL("./search.worker.ts", import.meta.url), {
				name: "campus-docs-search",
				type: "module",
			}),
	);
	clients.set(key, client);
	return client;
}

export function createDocsSearchClient(
	input: { searchIndexUrl: string; siteIndex: DocsSiteIndex },
	key: string,
	createWorker: () => SearchWorker,
): DocsSearchClient {
	const worker = createWorker();
	const pending = new Map<
		number,
		{
			reject: (error: Error) => void;
			resolve: (value: DocsSearchWorkerResponse) => void;
		}
	>();
	let nextRequestId = 0;
	let readyResolve!: () => void;
	let readyReject!: (error: Error) => void;
	let failed: Error | null = null;
	const ready = new Promise<void>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});

	const fail = (error: Error): void => {
		if (failed) {
			return;
		}
		failed = error;
		readyReject(error);
		for (const request of pending.values()) {
			request.reject(error);
		}
		pending.clear();
	};

	worker.addEventListener("error", () => fail(new Error("docs search worker failed")));
	worker.addEventListener("message", (event) => {
		const message = event.data;
		if (message.type === "ready") {
			readyResolve();
			return;
		}
		if (message.type === "error") {
			const error = new Error(message.message);
			if (message.requestId === undefined) {
				fail(error);
				return;
			}
			const request = pending.get(message.requestId);
			pending.delete(message.requestId);
			request?.reject(error);
			return;
		}
		const request = pending.get(message.requestId);
		pending.delete(message.requestId);
		request?.resolve(message);
	});
	worker.postMessage({
		key,
		searchIndexUrl: input.searchIndexUrl,
		siteIndex: input.siteIndex,
		type: "initialize",
	});

	async function request(message: DocsSearchWorkerOperation): Promise<DocsSearchWorkerResponse> {
		await ready;
		if (failed) {
			throw failed;
		}
		const requestId = ++nextRequestId;
		const response = new Promise<DocsSearchWorkerResponse>((resolve, reject) =>
			pending.set(requestId, { reject, resolve }),
		);
		worker.postMessage({ ...message, requestId });
		return response;
	}

	return {
		expand: async (query, docId) => {
			const response = await request({ docId, query, type: "expand" });
			if (response.type !== "document") {
				throw new Error("docs search worker returned an unexpected response");
			}
			return response.documentGroup;
		},
		ready: () => ready,
		search: async (search) => {
			const response = await request({ ...search, type: "search" });
			if (response.type !== "results") {
				throw new Error("docs search worker returned an unexpected response");
			}
			return {
				documentGroups: response.documentGroups,
				documentOffset: response.documentOffset,
				totalDocumentCount: response.totalDocumentCount,
			};
		},
	};
}
