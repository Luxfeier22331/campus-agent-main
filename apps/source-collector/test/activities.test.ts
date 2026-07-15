import { buildObjectStoreArtifactRef, sha256Hex } from "ingest-core";
import {
	type IngestionTaskExecutionSnapshot,
	validateIngestionTaskResult,
} from "ingestion-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceCollectorObjectStore } from "../src/object-store";

const temporal = vi.hoisted(() => ({
	heartbeat: vi.fn(),
	signal: new AbortController().signal,
}));
const officialWeb = vi.hoisted(() => ({
	createArtifactStore: vi.fn(() => ({})),
	crawlSite: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
	Context: {
		current: () => ({
			cancellationSignal: temporal.signal,
			heartbeat: temporal.heartbeat,
			info: { attempt: 1 },
		}),
	},
}));

vi.mock("../adapters/official-web/src/index.ts", () => ({
	createS3ArtifactStoreFromEnv: officialWeb.createArtifactStore,
	crawlSite: officialWeb.crawlSite,
}));

import { createSourceCollectorActivities } from "../src/activities";

describe("source collector Temporal activities", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		temporal.signal = new AbortController().signal;
	});

	it("verifies input, dispatches official-web capture and returns a pinned result manifest", async () => {
		const objectStore = new MemoryObjectStore("campus-agent-source");
		const requestBytes = new TextEncoder().encode(
			JSON.stringify({
				schema_version: "official_web_capture_request.v1",
				site_id: "muc_public",
				max_total_pages: 4,
			}),
		);
		const inputRef = buildObjectStoreArtifactRef({
			bucket: objectStore.sourceBucket,
			byteSize: requestBytes.byteLength,
			key: "requests/official-web.json",
			contentSha256: sha256Hex(requestBytes),
		});
		objectStore.seed(inputRef.uri, requestBytes);
		officialWeb.crawlSite.mockResolvedValue({
			failures: [],
			pages: [{ pageId: "page-1" }],
			uploadedArtifacts: [
				{
					byteSize: 128,
					contentSha256: "1".repeat(64),
					objectKey: "official-web/runs/run-official-web-001/page-observations.jsonl",
				},
			],
			urlResults: [{ outcome: "fetched" }],
		});
		const snapshot: IngestionTaskExecutionSnapshot = {
			schema_version: "ingestion_task_execution_snapshot.v1",
			task: {
				schema_version: "ingestion_task_envelope.v3",
				task_id: "task-official-web-001",
				run_id: "run-official-web-001",
				registry_task_id: "official_web.capture",
				input_ref: inputRef,
			},
			registry_task: {
				registry_task_id: "official_web.capture",
				executor_kind: "source_collector",
				input_contract: "official_web_capture_request.v1",
				output_contract: "official_web_source_manifest.v1",
				source: { family: "official_web", channel: "official_web" },
			},
		};

		const result = await createSourceCollectorActivities({
			env: { OFFICIAL_WEB_CONFIG_ROOT: "/configs/official-web" },
			objectStore,
		}).executeSourceCollectorTask(snapshot, null);

		expect(validateIngestionTaskResult(result)).toEqual({ ok: true });
		expect(result).toMatchObject({
			output_contract: "official_web_source_manifest.v1",
			registry_task_id: "official_web.capture",
			run_id: "run-official-web-001",
			summary: { failure_count: 0, page_count: 1, url_count: 1 },
			task_id: "task-official-web-001",
		});
		expect(officialWeb.crawlSite).toHaveBeenCalledWith(
			"muc_public",
			expect.objectContaining({
				configRoot: "/configs/official-web",
				crawlRunId: "run-official-web-001",
				maxTotalPages: 4,
			}),
		);
		const manifest = objectStore.readJson(result.result_ref.uri);
		expect(manifest).toMatchObject({
			artifacts: [
				{
					digest: `sha256:${"1".repeat(64)}`,
					uri: "s3://campus-agent-source/official-web/runs/run-official-web-001/page-observations.jsonl",
				},
			],
			schema_version: "official_web_source_manifest.v1",
		});
		expect(temporal.heartbeat).toHaveBeenCalledWith({
			phase: "result",
			task_id: "task-official-web-001",
		});
	});

	it("does not write a terminal result after Temporal cancellation", async () => {
		const controller = new AbortController();
		temporal.signal = controller.signal;
		const objectStore = new MemoryObjectStore("campus-agent-source");
		const requestBytes = new TextEncoder().encode(
			JSON.stringify({
				schema_version: "official_web_capture_request.v1",
				site_id: "muc_public",
			}),
		);
		const inputRef = buildObjectStoreArtifactRef({
			bucket: objectStore.sourceBucket,
			byteSize: requestBytes.byteLength,
			key: "requests/canceled-official-web.json",
			contentSha256: sha256Hex(requestBytes),
		});
		objectStore.seed(inputRef.uri, requestBytes);
		officialWeb.crawlSite.mockImplementation(async (_siteId, options) => {
			controller.abort();
			await options.reportProgress?.({ pagesFetched: 1 });
			throw new Error("unreachable");
		});
		const snapshot: IngestionTaskExecutionSnapshot = {
			schema_version: "ingestion_task_execution_snapshot.v1",
			task: {
				schema_version: "ingestion_task_envelope.v3",
				task_id: "task-official-web-canceled",
				run_id: "run-official-web-canceled",
				registry_task_id: "official_web.capture",
				input_ref: inputRef,
			},
			registry_task: {
				registry_task_id: "official_web.capture",
				executor_kind: "source_collector",
				input_contract: "official_web_capture_request.v1",
				output_contract: "official_web_source_manifest.v1",
				source: { family: "official_web", channel: "official_web" },
			},
		};

		await expect(
			createSourceCollectorActivities({
				env: { OFFICIAL_WEB_CONFIG_ROOT: "/configs/official-web" },
				objectStore,
			}).executeSourceCollectorTask(snapshot, null),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(objectStore.hasKeyPrefix("s3://campus-agent-source/ingestion-results/")).toBe(false);
	});
});

class MemoryObjectStore implements SourceCollectorObjectStore {
	readonly #objects = new Map<string, Uint8Array>();
	readonly sourceBucket: string;

	constructor(sourceBucket: string) {
		this.sourceBucket = sourceBucket;
	}

	seed(uri: string, bytes: Uint8Array): void {
		this.#objects.set(uri, bytes);
	}

	async getObject(input: { bucket: string; key: string }): Promise<Uint8Array> {
		const uri = `s3://${input.bucket}/${input.key}`;
		const bytes = this.#objects.get(uri);
		if (!bytes) {
			throw new Error(`missing test object: ${uri}`);
		}
		return bytes;
	}

	async createOrVerifyObject(input: {
		body: Uint8Array;
		bucket: string;
		contentType: string;
		key: string;
		metadata?: Record<string, string>;
	}): Promise<{ byteSize: number; contentSha256: string }> {
		this.#objects.set(`s3://${input.bucket}/${input.key}`, input.body);
		return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
	}

	readJson(uri: string): Record<string, unknown> {
		const bytes = this.#objects.get(uri);
		if (!bytes) {
			throw new Error(`missing test object: ${uri}`);
		}
		return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
	}

	hasKeyPrefix(prefix: string): boolean {
		return [...this.#objects.keys()].some((key) => key.startsWith(prefix));
	}
}
