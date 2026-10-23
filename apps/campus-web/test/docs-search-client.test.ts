import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createDocsSearchClient,
	type DocsSearchDocumentGroup,
	type DocsSearchWorkerRequest,
	type DocsSearchWorkerResponse,
	loadDocsSearchClient,
} from "../src/features/docs/search-client";
import { createLargeDocsSiteIndex } from "./helpers/docs-site-index-fixture";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("docs search worker client", () => {
	it("initializes the worker and routes paged query responses by request id", async () => {
		const worker = new FakeSearchWorker();
		const siteIndex = createLargeDocsSiteIndex();
		const client = createDocsSearchClient(
			{ searchIndexUrl: siteIndex.searchIndexUrl, siteIndex },
			siteIndex.searchIndexUrl,
			() => worker,
		);

		expect(worker.messages[0]).toEqual({
			key: siteIndex.searchIndexUrl,
			searchIndexUrl: siteIndex.searchIndexUrl,
			siteIndex,
			type: "initialize",
		});

		worker.respond({ type: "ready" });
		await expect(client.ready()).resolves.toBeUndefined();
		const first = client.search({
			documentLimit: 8,
			documentOffset: 0,
			query: "课程 地图",
		});
		const second = client.search({
			documentLimit: 8,
			documentOffset: 8,
			query: "奖学金 管理",
		});
		await Promise.resolve();
		expect(worker.messages.slice(1)).toEqual([
			{
				documentLimit: 8,
				documentOffset: 0,
				query: "课程 地图",
				requestId: 1,
				type: "search",
			},
			{
				documentLimit: 8,
				documentOffset: 8,
				query: "奖学金 管理",
				requestId: 2,
				type: "search",
			},
		]);

		worker.respond({
			documentGroups: [],
			documentOffset: 8,
			requestId: 2,
			totalDocumentCount: 10,
			type: "results",
		});
		worker.respond({
			documentGroups: [],
			documentOffset: 0,
			requestId: 1,
			totalDocumentCount: 10,
			type: "results",
		});
		await expect(first).resolves.toEqual({
			documentGroups: [],
			documentOffset: 0,
			totalDocumentCount: 10,
		});
		await expect(second).resolves.toEqual({
			documentGroups: [],
			documentOffset: 8,
			totalDocumentCount: 10,
		});
	});

	it("requests a complete result group only when a document is expanded", async () => {
		const worker = new FakeSearchWorker();
		const siteIndex = createLargeDocsSiteIndex();
		const client = createDocsSearchClient(
			{ searchIndexUrl: siteIndex.searchIndexUrl, siteIndex },
			siteIndex.searchIndexUrl,
			() => worker,
		);
		const group = createDocumentGroup();

		worker.respond({ type: "ready" });
		const expanded = client.expand("课程地图", group.document.docId);
		await Promise.resolve();
		expect(worker.messages.at(-1)).toEqual({
			docId: group.document.docId,
			query: "课程地图",
			requestId: 1,
			type: "expand",
		});

		worker.respond({ documentGroup: group, requestId: 1, type: "document" });
		await expect(expanded).resolves.toEqual(group);
	});

	it("rejects initialization and pending searches after a worker failure", async () => {
		const worker = new FakeSearchWorker();
		const siteIndex = createLargeDocsSiteIndex();
		const client = createDocsSearchClient(
			{ searchIndexUrl: siteIndex.searchIndexUrl, siteIndex },
			"failed-search-index",
			() => worker,
		);
		const ready = client.ready();

		worker.fail();

		await expect(ready).rejects.toThrow("docs search worker failed");
		await expect(
			client.search({ documentLimit: 8, documentOffset: 0, query: "课程" }),
		).rejects.toThrow("docs search worker failed");
	});

	it("does not fetch indexes on the main thread and reuses a client for one search index", () => {
		const workers: FakeSearchWorker[] = [];
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal(
			"Worker",
			class extends FakeSearchWorker {
				constructor() {
					super();
					workers.push(this);
				}
			},
		);
		const siteIndex = createLargeDocsSiteIndex();

		const first = loadDocsSearchClient({ searchIndexUrl: siteIndex.searchIndexUrl, siteIndex });
		const second = loadDocsSearchClient({ searchIndexUrl: siteIndex.searchIndexUrl, siteIndex });

		expect(first).toBe(second);
		expect(workers).toHaveLength(1);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

function createDocumentGroup(): DocsSearchDocumentGroup {
	const siteIndex = createLargeDocsSiteIndex();
	const document = siteIndex.collections[0]?.documents[0];
	if (!document) {
		throw new Error("docs site fixture is incomplete");
	}
	return {
		document: {
			canonicalUrl: document.canonicalUrl,
			collection: "undergraduate",
			collectionLabel: "本科培养方案",
			corpus: "curriculum",
			docId: document.docId,
			documentTitle: document.title,
			topicId: null,
			topicLabel: null,
		},
		isComplete: true,
		results: [],
		totalSectionCount: 0,
	};
}

class FakeSearchWorker {
	readonly messages: DocsSearchWorkerRequest[] = [];
	private readonly errorListeners: Array<() => void> = [];
	private readonly messageListeners: Array<
		(event: MessageEvent<DocsSearchWorkerResponse>) => void
	> = [];

	addEventListener(type: "error", listener: () => void): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<DocsSearchWorkerResponse>) => void,
	): void;
	addEventListener(
		type: "error" | "message",
		listener: (() => void) | ((event: MessageEvent<DocsSearchWorkerResponse>) => void),
	): void {
		if (type === "error") {
			this.errorListeners.push(listener as () => void);
		} else {
			this.messageListeners.push(
				listener as (event: MessageEvent<DocsSearchWorkerResponse>) => void,
			);
		}
	}

	fail(): void {
		for (const listener of this.errorListeners) {
			listener();
		}
	}

	postMessage(message: DocsSearchWorkerRequest): void {
		this.messages.push(message);
	}

	respond(message: DocsSearchWorkerResponse): void {
		const event = { data: message } as MessageEvent<DocsSearchWorkerResponse>;
		for (const listener of this.messageListeners) {
			listener(event);
		}
	}
}
