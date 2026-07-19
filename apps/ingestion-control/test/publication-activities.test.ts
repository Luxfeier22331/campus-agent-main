import {
	buildObjectStoreArtifactRef,
	createIngestionTaskRegistryCatalog,
	parseJsonObjectBytes,
	parseS3Uri,
	sha256Hex,
} from "ingest-core";
import type { IngestionArtifactRef, IngestionTaskRegistryTask } from "ingestion-contracts";
import { describe, expect, it } from "vitest";
import type { IngestionObjectStore } from "../src/object-store";
import {
	createInternalPortalPublicationActivities,
	type InternalPortalPublicationContext,
} from "../src/publication-activities";
import type {
	IngestionTaskRecord,
	OfflineReleaseRecord,
	OfflineReleaseStore,
	OfflineReleaseStreamRecord,
} from "../src/types";

const digest = `sha256:${"1".repeat(64)}`;
const tasks: IngestionTaskRegistryTask[] = [
	{
		executor_kind: "source_collector",
		input_contract: "internal_portal_notice_capture_request.v2",
		output_contract: "internal_portal_notice_capture_result.v1",
		registry_task_id: "internal_portal.notice.capture",
		source: { channel: "internal_portal", family: "authenticated_notice" },
		target: { collection: "internal_notice", corpus: "campus_notices" },
	},
	{
		executor_kind: "typescript_kernel",
		input_contract: "internal_portal_notice_capture_result.v1",
		kernel_id: "materialize-internal-portal-notice",
		output_contract: "internal_portal_notice_materialization_result.v1",
		registry_task_id: "campus_notices.internal_notice.materialize",
		target: { collection: "internal_notice", corpus: "campus_notices" },
	},
	{
		executor_kind: "rust_kernel",
		input_contract: "canonical_document_units.v1",
		kernel_id: "validate-document-units",
		output_contract: "document_units_validation_report.v1",
		registry_task_id: "campus_notices.internal_notice.document_units_validate",
		target: { collection: "internal_notice", corpus: "campus_notices" },
	},
];

describe("internal portal publication activities", () => {
	it("upgrades the scheduled incremental check to reconcile when the weekly check is due", async () => {
		const objectStore = new MemoryObjectStore();
		const releaseStore = new MemoryReleaseStore(
			{ notices: [{ last_released_notice_id: 100, notice_type: "5" }] },
			null,
		);
		const activities = createInternalPortalPublicationActivities({
			objectStore,
			registryCatalog: createIngestionTaskRegistryCatalog([
				{ schema_version: "ingestion_task_registry.v3", tasks },
			]),
			releaseStore,
			siteId: "muc_internal_portal",
		});
		const context = await activities.prepareInternalPortalPublication({
			collectionMode: "incremental",
			createdBy: "schedule:internal-portal-notice",
			fileReleaseId: null,
			maxNotices: null,
			overlapPages: 1,
			runId: "run-reconcile",
			selectedNotices: [],
			startedAt: "2026-07-17T00:00:00.000Z",
			surface: "notice",
			workflowId: "ingestion/notice/run-reconcile",
			workflowRunId: "run-reconcile",
		});

		expect(context.collectionMode).toBe("reconcile");
		expect(objectStore.readJson(context.captureSnapshot.task.input_ref)).toMatchObject({
			checkpoints: [],
			collection_mode: "reconcile",
		});
	});

	it("pins the notice request, advances its checkpoint, and commits a full release", async () => {
		const objectStore = new MemoryObjectStore();
		const releaseStore = new MemoryReleaseStore({
			notices: [{ last_released_notice_id: 100, notice_type: "5" }],
		});
		const activities = createInternalPortalPublicationActivities({
			objectStore,
			registryCatalog: createIngestionTaskRegistryCatalog([
				{ schema_version: "ingestion_task_registry.v3", tasks },
			]),
			releaseStore,
			siteId: "muc_internal_portal",
		});
		const context = await activities.prepareInternalPortalPublication({
			collectionMode: "incremental",
			createdBy: "schedule:internal-portal-notice",
			fileReleaseId: null,
			maxNotices: null,
			overlapPages: 1,
			runId: "run-001",
			selectedNotices: [],
			startedAt: "2026-07-17T00:00:00.000Z",
			surface: "notice",
			workflowId: "ingestion/notice/run-001",
			workflowRunId: "run-001",
		});
		const request = objectStore.readJson(context.captureSnapshot.task.input_ref);
		expect(request).toMatchObject({
			checkpoints: [{ last_released_notice_id: 100, notice_type: "5" }],
			collection_mode: "incremental",
			overlap_pages: 1,
		});

		const checkpointRef = objectStore.writeJson("source", "checkpoint.json", {
			captured_at: "2026-07-17T00:01:00.000Z",
			next: [{ last_released_notice_id: 110, notice_type: "5" }],
			previous: [{ last_released_notice_id: 100, notice_type: "5" }],
			schema_version: "internal_portal_notice_checkpoint.v1",
		});
		const exportManifestRef = objectStore.writeJson("source", "export-manifest.json", {
			source_config_digest: `sha256:${"3".repeat(64)}`,
		});
		const captureResultRef = objectStore.writeJson("source", "capture-result.json", {
			artifacts: [
				{ ...artifact("source", "capture-release.json"), role: "capture_release" },
				{ ...checkpointRef, role: "capture_checkpoint" },
				{ ...exportManifestRef, role: "export_manifest" },
			],
			registry_task_id: "internal_portal.notice.capture",
			run_id: "run-001",
			schema_version: "internal_portal_notice_capture_result.v1",
			summary: { notice_count: 1 },
			task_id: "run-001:capture",
		});
		const captureTask = completedTask(
			context,
			context.captureSnapshot.registry_task,
			captureResultRef,
			"capture",
		);
		const materializationSnapshot = await activities.prepareInternalPortalMaterialization({
			captureTask,
			context,
		});
		expect(materializationSnapshot.task.input_ref).toEqual(captureResultRef);

		const documentUnitsRef = objectStore.writeText(
			"derived",
			"document-units.jsonl",
			`${JSON.stringify({ anchor: {}, chunk_id: "unit-1", clean_text: "text", doc_id: "notice:muc:110", metadata: {}, root_unit_id: "unit-1", text: "text", version_id: `sha256:${"2".repeat(64)}` })}\n`,
		);
		const itemManifestRef = objectStore.writeJson(
			"derived",
			"notice/source-truth/notice-manifest.json",
			{
				raw_asset_id: "asset:authenticated-notice:muc:110",
				raw_version_id: `sha256:${"2".repeat(64)}`,
			},
		);
		const itemContentBlocksRef = objectStore.writeText(
			"derived",
			"notice/source-truth/content-blocks.jsonl",
			"{}\n",
		);
		const itemAttachmentRefsRef = objectStore.writeText(
			"derived",
			"notice/source-truth/attachment-refs.jsonl",
			"",
		);
		const itemCanonicalMarkdownRef = objectStore.writeText(
			"derived",
			"notice/canonical/canonical.md",
			"# Notice\n",
		);
		const itemDocumentUnitsRef = objectStore.writeText(
			"derived",
			"notice/canonical/document-units.jsonl",
			"{}\n",
		);
		const materializationResultRef = objectStore.writeJson(
			"derived",
			"materialization-result.json",
			{
				artifacts: [{ ...documentUnitsRef, role: "canonical_document_units" }],
				items: [
					{
						artifacts: [
							{ ...itemManifestRef, role: "source_manifest" },
							{ ...itemContentBlocksRef, role: "content_blocks" },
							{ ...itemAttachmentRefsRef, role: "attachment_refs" },
							{ ...itemCanonicalMarkdownRef, role: "canonical_markdown" },
							{ ...itemDocumentUnitsRef, role: "canonical_document_units" },
						],
						item_id: "asset:authenticated-notice:muc:110",
						version_id: `sha256:${"2".repeat(64)}`,
					},
				],
				registry_task_id: "campus_notices.internal_notice.materialize",
				run_id: "run-001",
				schema_version: "internal_portal_notice_materialization_result.v1",
				summary: { document_count: 1 },
				task_id: "run-001:materialize",
			},
		);
		const materializationTask = completedTask(
			context,
			materializationSnapshot.registry_task,
			materializationResultRef,
			"materialize",
		);
		const validationSnapshot = await activities.prepareInternalPortalNoticeValidation({
			context,
			materializationTask,
		});
		const validationTask = completedTask(
			context,
			validationSnapshot.registry_task,
			artifact("derived", "validation-result.json"),
			"validate",
		);

		const commitInput = {
			captureTask,
			context,
			materializationTask,
			validationTask,
		};
		const committed = await activities.commitInternalPortalPublication(commitInput);
		if (!committed.release) {
			throw new Error("expected publication release");
		}

		expect(committed.stream.checkpoint).toEqual({
			notices: [{ last_released_notice_id: 110, notice_type: "5" }],
		});
		const release = objectStore.readJson(committed.release.manifest_ref);
		expect(release).toMatchObject({
			changes: {
				added_item_ids: ["asset:authenticated-notice:muc:110"],
				updated_item_ids: [],
				withdrawn_item_ids: [],
			},
			items: [{ item_id: "asset:authenticated-notice:muc:110" }],
			pipeline: { source_config_digest: `sha256:${"3".repeat(64)}` },
			previous_release_id: null,
			schema_version: "ingestion_offline_release.v1",
		});

		releaseStore.advanceStream("run-002");
		const retried = await activities.commitInternalPortalPublication(commitInput);
		if (!retried.release) {
			throw new Error("expected idempotent publication release");
		}
		expect(retried.release.release_id).toBe(committed.release.release_id);
		expect(retried.stream).toMatchObject({
			current_release_id: "release:run-002:v2",
			version: 2,
		});
	});
});

class MemoryObjectStore implements IngestionObjectStore {
	readonly derivedBucket = "derived";
	readonly sourceBucket = "source";
	readonly objects = new Map<string, Uint8Array>();

	async createOrVerifyObject(input: { body: Uint8Array; bucket: string; key: string }) {
		const key = `${input.bucket}/${input.key}`;
		const existing = this.objects.get(key);
		if (existing && sha256Hex(existing) !== sha256Hex(input.body)) {
			throw new Error(`object conflict: ${key}`);
		}
		this.objects.set(key, input.body);
		return { byteSize: input.body.byteLength, contentSha256: sha256Hex(input.body) };
	}

	async getObject(input: { bucket: string; key: string }) {
		const value = this.objects.get(`${input.bucket}/${input.key}`);
		if (!value) {
			throw new Error("object not found");
		}
		return value;
	}

	async headObject(input: { bucket: string; key: string }) {
		const value = await this.getObject(input);
		return { byteSize: value.byteLength, contentSha256: sha256Hex(value) };
	}

	readJson(ref: IngestionArtifactRef) {
		const location = parseS3Uri(ref);
		const bytes = this.objects.get(`${location.bucket}/${location.key}`);
		if (!bytes) {
			throw new Error("object not found");
		}
		return parseJsonObjectBytes(bytes, "test object");
	}

	writeJson(bucket: string, key: string, value: unknown) {
		return this.writeText(bucket, key, JSON.stringify(value));
	}

	writeText(bucket: string, key: string, value: string) {
		const bytes = new TextEncoder().encode(value);
		this.objects.set(`${bucket}/${key}`, bytes);
		return buildObjectStoreArtifactRef({
			bucket,
			byteSize: bytes.byteLength,
			contentSha256: sha256Hex(bytes),
			key,
		});
	}
}

class MemoryReleaseStore implements OfflineReleaseStore {
	readonly releases = new Map<string, OfflineReleaseRecord>();
	stream: OfflineReleaseStreamRecord;

	constructor(
		checkpoint: Record<string, unknown>,
		lastReconcileAt: string | null = "2026-07-16T00:00:00.000Z",
	) {
		this.stream = {
			checkpoint,
			collection: "internal_notice",
			corpus: "campus_notices",
			created_at: "2026-07-17T00:00:00.000Z",
			current_release_id: null,
			source_channel: "internal_portal",
			source_surface: "notice",
			stream_id: "internal_portal:muc_internal_portal:notice",
			updated_at: "2026-07-17T00:00:00.000Z",
			version: 0,
			last_check_at: null,
			last_check_mode: null,
			last_check_outcome: null,
			last_check_error_code: null,
			last_reconcile_at: lastReconcileAt,
			last_published_at: null,
			last_added_count: 0,
			last_updated_count: 0,
			last_withdrawn_count: 0,
		};
	}

	ensureStream() {
		return structuredClone(this.stream);
	}
	getCurrentRelease() {
		const release = this.stream.current_release_id
			? [...this.releases.values()].find(
					(candidate) => candidate.release_id === this.stream.current_release_id,
				)
			: null;
		return release ? structuredClone(release) : null;
	}
	getReleaseByRun(_streamId: string, runId: string) {
		const release = this.releases.get(runId);
		return release ? structuredClone(release) : null;
	}
	getStream() {
		return structuredClone(this.stream);
	}
	recordCheck(input: Parameters<OfflineReleaseStore["recordCheck"]>[0]) {
		this.applyCheck(input.check);
		return structuredClone(this.stream);
	}
	commitRelease(input: Parameters<OfflineReleaseStore["commitRelease"]>[0]) {
		const release = { ...input.release, committed_at: "2026-07-17T00:02:00.000Z" };
		this.releases.set(release.run_id, release);
		this.stream = {
			...this.stream,
			checkpoint: structuredClone(input.checkpoint),
			current_release_id: release.release_id,
			version: this.stream.version + 1,
		};
		this.applyCheck(input.check);
		return { release: structuredClone(release), stream: structuredClone(this.stream) };
	}

	private applyCheck(check: Parameters<OfflineReleaseStore["recordCheck"]>[0]["check"]) {
		this.stream = {
			...this.stream,
			last_added_count: check.addedCount,
			last_check_at: check.checkedAt,
			last_check_error_code: check.errorCode,
			last_check_mode: check.mode,
			last_check_outcome: check.outcome,
			last_published_at:
				check.outcome === "published" ? check.checkedAt : this.stream.last_published_at,
			last_reconcile_at:
				check.mode === "reconcile" &&
				(check.outcome === "published" || check.outcome === "unchanged")
					? check.checkedAt
					: this.stream.last_reconcile_at,
			last_updated_count: check.updatedCount,
			last_withdrawn_count: check.withdrawnCount,
		};
	}

	advanceStream(runId: string) {
		const previous = this.getCurrentRelease();
		if (!previous) {
			throw new Error("current release is required");
		}
		const release: OfflineReleaseRecord = {
			...previous,
			committed_at: "2026-07-17T00:03:00.000Z",
			previous_release_id: previous.release_id,
			release_id: `release:${runId}:v${this.stream.version + 1}`,
			run_id: runId,
			workflow_id: `ingestion/${runId}`,
			workflow_run_id: runId,
		};
		this.releases.set(runId, release);
		this.stream = {
			...this.stream,
			current_release_id: release.release_id,
			version: this.stream.version + 1,
		};
	}
}

function artifact(bucket: string, key: string): IngestionArtifactRef {
	return { byte_size: 1, digest, kind: "object_store", uri: `s3://${bucket}/${key}` };
}

function completedTask(
	context: InternalPortalPublicationContext,
	registryTask: IngestionTaskRegistryTask,
	resultRef: IngestionArtifactRef,
	stage: "capture" | "materialize" | "validate",
): IngestionTaskRecord {
	return {
		collection: registryTask.target?.collection ?? null,
		corpus: registryTask.target?.corpus ?? null,
		created_at: context.startedAt,
		created_by: context.createdBy,
		error_code: null,
		error_message: null,
		executor_kind: registryTask.executor_kind,
		input_contract: registryTask.input_contract,
		input_ref: artifact("source", `${stage}-input.json`),
		output_contract: registryTask.output_contract,
		pipeline_workflow_id: context.workflowId,
		registry_task_id: registryTask.registry_task_id,
		result_contract: registryTask.output_contract,
		result_ref: resultRef,
		retry_of_task_id: null,
		run_id: context.runId,
		schema_version: "ingestion_task_envelope.v3",
		source_channel: registryTask.source?.channel ?? null,
		source_family: registryTask.source?.family ?? null,
		status: "completed",
		summary: {},
		task_id: `${context.runId}:${stage}`,
		updated_at: context.startedAt,
		workflow_id: `ingestion/${context.runId}:${stage}`,
		workflow_run_id: `${context.runId}:${stage}:workflow`,
	};
}
