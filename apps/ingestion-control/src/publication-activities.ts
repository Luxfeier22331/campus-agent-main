import { ApplicationFailure } from "@temporalio/activity";
import {
	assertArtifactRefBytes,
	buildObjectStoreArtifactRef,
	canonicalJsonString,
	createIngestionTaskExecutionSnapshot,
	encodeCanonicalJson,
	encodeObjectKeySegment,
	type IngestionTaskRegistryCatalog,
	parseJsonObjectBytes,
	parseRequiredText,
	parseS3Uri,
} from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionOfflineRelease,
	IngestionOfflineReleaseItem,
	IngestionTaskExecutionSnapshot,
	InternalPortalCaptureRequest,
	InternalPortalNoticeCaptureCheckpoint,
	InternalPortalStageResultManifest,
} from "ingestion-contracts";
import {
	validateIngestionOfflineRelease,
	validateInternalPortalCaptureRequest,
	validateInternalPortalNoticeCheckpoint,
	validateInternalPortalStageResult,
} from "ingestion-contracts";
import type { IngestionObjectStore } from "./object-store";
import { OfflineReleaseConcurrencyError } from "./offline-release-store";
import type {
	IngestionTaskRecord,
	OfflineReleaseRecord,
	OfflineReleaseStore,
	OfflineReleaseStreamRecord,
} from "./types";

const NOTICE_CAPTURE_TASK_ID = "internal_portal.notice.capture";
const NOTICE_MATERIALIZE_TASK_ID = "campus_notices.internal_notice.materialize";
const NOTICE_VALIDATE_TASK_ID = "campus_notices.internal_notice.document_units_validate";
const FILE_RELEASE_CAPTURE_TASK_ID = "internal_portal.file_release.capture";
const FILE_RELEASE_MATERIALIZE_TASK_ID = "authenticated_documents.file_release_source.materialize";
const NOTICE_RECONCILE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

export type InternalPortalPublicationSurface = "file_release" | "notice";

export interface InternalPortalPublicationContext {
	captureSnapshot: IngestionTaskExecutionSnapshot;
	collectionMode: "reconcile" | "incremental" | "selected";
	createdBy: string;
	fileReleaseId: number | null;
	runId: string;
	siteId: string;
	startedAt: string;
	stream: OfflineReleaseStreamRecord;
	surface: InternalPortalPublicationSurface;
	workflowId: string;
	workflowRunId: string;
	codeCommit: string | null;
	registryDigest: string | null;
	workerBuildId: string | null;
}

export interface PrepareInternalPortalPublicationInput {
	collectionMode: "reconcile" | "incremental" | "selected";
	createdBy: string;
	fileReleaseId: number | null;
	maxNotices: number | null;
	overlapPages: number;
	runId: string;
	selectedNotices: Array<{
		notice_id: number;
		notice_type: string;
		notice_type_name?: string;
		notice_title?: string;
	}>;
	startedAt: string;
	surface: InternalPortalPublicationSurface;
	workflowId: string;
	workflowRunId: string;
}

export interface CommitInternalPortalPublicationInput {
	captureTask: IngestionTaskRecord;
	context: InternalPortalPublicationContext;
	materializationTask: IngestionTaskRecord;
	validationTask: IngestionTaskRecord | null;
}

export interface InternalPortalPublicationActivities {
	prepareInternalPortalPublication(
		input: PrepareInternalPortalPublicationInput,
	): Promise<InternalPortalPublicationContext>;
	prepareInternalPortalMaterialization(input: {
		captureTask: IngestionTaskRecord;
		context: InternalPortalPublicationContext;
	}): Promise<IngestionTaskExecutionSnapshot>;
	prepareInternalPortalNoticeValidation(input: {
		context: InternalPortalPublicationContext;
		materializationTask: IngestionTaskRecord;
	}): Promise<IngestionTaskExecutionSnapshot>;
	commitInternalPortalPublication(input: CommitInternalPortalPublicationInput): Promise<{
		changes: InternalPortalPublicationChanges;
		outcome: "published" | "unchanged";
		release: OfflineReleaseRecord | null;
		stream: OfflineReleaseStreamRecord;
	}>;
	recordInternalPortalPublicationCheck(input: {
		context: InternalPortalPublicationContext;
		errorCode: string;
		outcome: "deferred" | "failed";
	}): Promise<OfflineReleaseStreamRecord>;
}

export interface InternalPortalPublicationChanges {
	addedItemIds: string[];
	updatedItemIds: string[];
	withdrawnItemIds: string[];
}

export function createInternalPortalPublicationActivities(input: {
	registryCatalog: IngestionTaskRegistryCatalog;
	objectStore: IngestionObjectStore;
	releaseStore: OfflineReleaseStore;
	releaseMetadata?: {
		codeCommit: string | null;
		registryDigest: string | null;
		workerBuildId: string | null;
	};
	siteId: string;
}): InternalPortalPublicationActivities {
	return {
		async prepareInternalPortalPublication(activityInput) {
			assertPublicationInput(activityInput);
			const target = publicationTarget(activityInput.surface);
			const stream = await input.releaseStore.ensureStream({
				collection: target.collection,
				corpus: target.corpus,
				sourceChannel: "internal_portal",
				sourceSurface: activityInput.surface,
				streamId: internalPortalReleaseStreamId(input.siteId, activityInput.surface),
			});
			const collectionMode = resolveNoticeCollectionMode(activityInput, stream);
			const request = buildCaptureRequest({ ...activityInput, collectionMode }, stream);
			const requestRef = await writeCaptureRequest({
				objectStore: input.objectStore,
				request,
				runId: activityInput.runId,
				siteId: input.siteId,
				surface: activityInput.surface,
			});
			return {
				captureSnapshot: taskSnapshot({
					inputRef: requestRef,
					registryCatalog: input.registryCatalog,
					registryTaskId:
						activityInput.surface === "notice"
							? NOTICE_CAPTURE_TASK_ID
							: FILE_RELEASE_CAPTURE_TASK_ID,
					runId: activityInput.runId,
					taskId: childTaskId(activityInput.runId, "capture"),
				}),
				collectionMode,
				createdBy: activityInput.createdBy,
				fileReleaseId: activityInput.fileReleaseId,
				runId: activityInput.runId,
				siteId: input.siteId,
				startedAt: activityInput.startedAt,
				stream,
				surface: activityInput.surface,
				workflowId: activityInput.workflowId,
				workflowRunId: activityInput.workflowRunId,
				codeCommit: input.releaseMetadata?.codeCommit ?? null,
				registryDigest: input.releaseMetadata?.registryDigest ?? null,
				workerBuildId: input.releaseMetadata?.workerBuildId ?? null,
			};
		},

		async prepareInternalPortalMaterialization(activityInput) {
			const resultRef = requireCompletedResult(activityInput.captureTask, "capture");
			return taskSnapshot({
				inputRef: resultRef,
				registryCatalog: input.registryCatalog,
				registryTaskId:
					activityInput.context.surface === "notice"
						? NOTICE_MATERIALIZE_TASK_ID
						: FILE_RELEASE_MATERIALIZE_TASK_ID,
				runId: activityInput.context.runId,
				taskId: childTaskId(activityInput.context.runId, "materialize"),
			});
		},

		async prepareInternalPortalNoticeValidation(activityInput) {
			if (activityInput.context.surface !== "notice") {
				throw ApplicationFailure.nonRetryable(
					"document-unit validation is only defined for notice publication",
					"invalid_publication_plan",
				);
			}
			const manifest = await readStageResult(
				input.objectStore,
				activityInput.materializationTask,
				"internal_portal_notice_materialization_result.v1",
			);
			const validationInput = requireSingleRole(manifest, "canonical_document_units");
			return taskSnapshot({
				inputRef: validationInput,
				registryCatalog: input.registryCatalog,
				registryTaskId: NOTICE_VALIDATE_TASK_ID,
				runId: activityInput.context.runId,
				taskId: childTaskId(activityInput.context.runId, "validate"),
			});
		},

		async commitInternalPortalPublication(activityInput) {
			assertTaskBelongsToPublication(activityInput.captureTask, activityInput.context);
			assertTaskBelongsToPublication(activityInput.materializationTask, activityInput.context);
			if (activityInput.context.surface === "notice") {
				if (!activityInput.validationTask) {
					throw ApplicationFailure.nonRetryable(
						"notice publication requires a completed validation task",
						"invalid_publication_plan",
					);
				}
				assertTaskBelongsToPublication(activityInput.validationTask, activityInput.context);
				requireCompletedResult(activityInput.validationTask, "validation");
			} else if (activityInput.validationTask) {
				throw ApplicationFailure.nonRetryable(
					"file-release publication does not accept a validation task",
					"invalid_publication_plan",
				);
			}
			const materialization = await readStageResult(
				input.objectStore,
				activityInput.materializationTask,
				activityInput.context.surface === "notice"
					? "internal_portal_notice_materialization_result.v1"
					: "internal_portal_file_release_materialization_result.v1",
			);
			if (!materialization.items || materialization.items.length === 0) {
				throw ApplicationFailure.nonRetryable(
					"materialization result contains no release items",
					"invalid_ingestion_release",
				);
			}
			const nextCheckpoint = await resolveReleaseCheckpoint({
				captureTask: activityInput.captureTask,
				collectionMode: activityInput.context.collectionMode,
				currentCheckpoint: activityInput.context.stream.checkpoint,
				objectStore: input.objectStore,
				surface: activityInput.context.surface,
			});
			const sourceConfigDigest =
				activityInput.context.surface === "notice"
					? await readNoticeSourceConfigDigest(input.objectStore, activityInput.captureTask)
					: null;
			return await commitReleaseWithCurrentStream({
				context: activityInput.context,
				incomingItems: materialization.items,
				nextCheckpoint,
				objectStore: input.objectStore,
				releaseStore: input.releaseStore,
				sourceConfigDigest,
				taskIds: [
					activityInput.captureTask.task_id,
					activityInput.materializationTask.task_id,
					...(activityInput.validationTask ? [activityInput.validationTask.task_id] : []),
				],
			});
		},

		async recordInternalPortalPublicationCheck(activityInput) {
			return await input.releaseStore.recordCheck({
				check: {
					addedCount: 0,
					checkedAt: activityInput.context.startedAt,
					errorCode: activityInput.errorCode,
					mode: activityInput.context.collectionMode,
					outcome: activityInput.outcome,
					updatedCount: 0,
					withdrawnCount: 0,
				},
				streamId: activityInput.context.stream.stream_id,
			});
		},
	};
}

function resolveNoticeCollectionMode(
	input: PrepareInternalPortalPublicationInput,
	stream: OfflineReleaseStreamRecord,
): PrepareInternalPortalPublicationInput["collectionMode"] {
	if (input.surface !== "notice" || input.collectionMode !== "incremental") {
		return input.collectionMode;
	}
	const lastReconcileAt = stream.last_reconcile_at
		? Date.parse(stream.last_reconcile_at)
		: Number.NaN;
	const startedAt = Date.parse(input.startedAt);
	if (!Number.isFinite(startedAt)) {
		throw ApplicationFailure.nonRetryable(
			"publication startedAt is invalid",
			"invalid_publication_plan",
		);
	}
	return !Number.isFinite(lastReconcileAt) ||
		startedAt - lastReconcileAt >= NOTICE_RECONCILE_INTERVAL_MS
		? "reconcile"
		: "incremental";
}

function buildCaptureRequest(
	input: PrepareInternalPortalPublicationInput,
	stream: OfflineReleaseStreamRecord,
): InternalPortalCaptureRequest {
	if (input.surface === "file_release") {
		return {
			file_release_id: input.fileReleaseId as number,
			schema_version: "internal_portal_file_release_capture_request.v2",
		};
	}
	return {
		checkpoints:
			input.collectionMode === "incremental" ? readNoticeCheckpoints(stream.checkpoint) : [],
		collection_mode: input.collectionMode,
		...(input.maxNotices ? { max_notices: input.maxNotices } : {}),
		overlap_pages: input.overlapPages,
		schema_version: "internal_portal_notice_capture_request.v2",
		...(input.selectedNotices.length > 0 ? { selected_notices: input.selectedNotices } : {}),
	};
}

async function writeCaptureRequest(input: {
	objectStore: IngestionObjectStore;
	request: InternalPortalCaptureRequest;
	runId: string;
	siteId: string;
	surface: InternalPortalPublicationSurface;
}): Promise<IngestionArtifactRef> {
	const validation = validateInternalPortalCaptureRequest(input.request);
	if (!validation.ok) {
		throw ApplicationFailure.nonRetryable(
			`invalid internal portal capture request: ${validation.errors.join("; ")}`,
			"invalid_capture_request",
		);
	}
	const body = encodeCanonicalJson(input.request);
	const key = [
		"ingestion-requests",
		"internal-portal",
		encodeObjectKeySegment(input.siteId),
		input.surface,
		"runs",
		encodeObjectKeySegment(input.runId),
		"capture.json",
	].join("/");
	const write = await input.objectStore.createOrVerifyObject({
		body,
		bucket: input.objectStore.sourceBucket,
		contentType: "application/json",
		key,
	});
	return buildObjectStoreArtifactRef({
		bucket: input.objectStore.sourceBucket,
		byteSize: write.byteSize,
		contentSha256: write.contentSha256,
		key,
	});
}

function taskSnapshot(input: {
	inputRef: IngestionArtifactRef;
	registryCatalog: IngestionTaskRegistryCatalog;
	registryTaskId: string;
	runId: string;
	taskId: string;
}): IngestionTaskExecutionSnapshot {
	return createIngestionTaskExecutionSnapshot({
		registryTask: input.registryCatalog.requireTaskById(input.registryTaskId),
		task: {
			input_ref: input.inputRef,
			registry_task_id: input.registryTaskId,
			run_id: input.runId,
			schema_version: "ingestion_task_envelope.v3",
			task_id: input.taskId,
		},
	});
}

async function readStageResult(
	objectStore: IngestionObjectStore,
	task: IngestionTaskRecord,
	expectedContract: InternalPortalStageResultManifest["schema_version"],
): Promise<InternalPortalStageResultManifest> {
	const ref = requireCompletedResult(task, "stage");
	const location = parseS3Uri(ref);
	const bytes = await objectStore.getObject(location);
	assertArtifactRefBytes({ bytes, label: "internal portal stage result", ref });
	const value = parseJsonObjectBytes(bytes, "internal portal stage result");
	const validation = validateInternalPortalStageResult(value);
	if (!validation.ok) {
		throw ApplicationFailure.nonRetryable(
			`invalid internal portal stage result: ${validation.errors.join("; ")}`,
			"invalid_ingestion_release",
		);
	}
	const manifest = value as unknown as InternalPortalStageResultManifest;
	if (
		manifest.schema_version !== expectedContract ||
		manifest.task_id !== task.task_id ||
		manifest.run_id !== task.run_id ||
		manifest.registry_task_id !== task.registry_task_id
	) {
		throw ApplicationFailure.nonRetryable(
			"internal portal stage result identity does not match its task",
			"invalid_ingestion_release",
		);
	}
	return manifest;
}

function requireSingleRole(
	manifest: InternalPortalStageResultManifest,
	role: "canonical_document_units" | "capture_checkpoint" | "export_manifest",
): IngestionArtifactRef {
	const matches = manifest.artifacts.filter((artifact) => artifact.role === role);
	if (matches.length !== 1) {
		throw ApplicationFailure.nonRetryable(
			`stage result must contain exactly one ${role} artifact`,
			"invalid_ingestion_release",
		);
	}
	const { role: _role, ...ref } = matches[0];
	return ref;
}

async function resolveReleaseCheckpoint(input: {
	captureTask: IngestionTaskRecord;
	collectionMode: InternalPortalPublicationContext["collectionMode"];
	currentCheckpoint: Record<string, unknown>;
	objectStore: IngestionObjectStore;
	surface: InternalPortalPublicationSurface;
}): Promise<Record<string, unknown>> {
	if (input.surface === "file_release" || input.collectionMode !== "incremental") {
		return structuredClone(input.currentCheckpoint);
	}
	const capture = await readStageResult(
		input.objectStore,
		input.captureTask,
		"internal_portal_notice_capture_result.v1",
	);
	const checkpointRef = requireSingleRole(capture, "capture_checkpoint");
	const location = parseS3Uri(checkpointRef);
	const bytes = await input.objectStore.getObject(location);
	assertArtifactRefBytes({ bytes, label: "internal portal notice checkpoint", ref: checkpointRef });
	const value = parseJsonObjectBytes(bytes, "internal portal notice checkpoint");
	const validation = validateInternalPortalNoticeCheckpoint(value);
	if (!validation.ok) {
		throw ApplicationFailure.nonRetryable(
			`invalid internal portal notice checkpoint: ${validation.errors.join("; ")}`,
			"invalid_ingestion_release",
		);
	}
	const checkpoint = value as unknown as InternalPortalNoticeCaptureCheckpoint;
	const expectedPrevious = readNoticeCheckpoints(input.currentCheckpoint);
	if (JSON.stringify(checkpoint.previous) !== JSON.stringify(expectedPrevious)) {
		throw ApplicationFailure.nonRetryable(
			"notice checkpoint does not match the release stream checkpoint",
			"stale_notice_checkpoint",
		);
	}
	return { notices: checkpoint.next };
}

async function commitReleaseWithCurrentStream(input: {
	context: InternalPortalPublicationContext;
	incomingItems: IngestionOfflineReleaseItem[];
	nextCheckpoint: Record<string, unknown>;
	objectStore: IngestionObjectStore;
	releaseStore: OfflineReleaseStore;
	sourceConfigDigest: string | null;
	taskIds: string[];
}): Promise<{
	changes: InternalPortalPublicationChanges;
	outcome: "published" | "unchanged";
	release: OfflineReleaseRecord | null;
	stream: OfflineReleaseStreamRecord;
}> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const stream = await input.releaseStore.getStream(input.context.stream.stream_id);
		if (!stream) {
			throw new Error(`offline release stream not found: ${input.context.stream.stream_id}`);
		}
		const existingRelease = await input.releaseStore.getReleaseByRun(
			stream.stream_id,
			input.context.runId,
		);
		if (existingRelease) {
			if (
				existingRelease.workflow_id !== input.context.workflowId ||
				existingRelease.workflow_run_id !== input.context.workflowRunId
			) {
				throw ApplicationFailure.nonRetryable(
					"offline release run belongs to a different workflow",
					"invalid_publication_plan",
				);
			}
			return {
				changes: { addedItemIds: [], updatedItemIds: [], withdrawnItemIds: [] },
				outcome: "published",
				release: existingRelease,
				stream,
			};
		}
		const currentRelease = await input.releaseStore.getCurrentRelease(stream.stream_id);
		if (input.context.surface === "notice" && stream.version !== input.context.stream.version) {
			throw ApplicationFailure.nonRetryable(
				"notice release stream changed during publication",
				"stale_notice_checkpoint",
			);
		}
		const previousManifest = currentRelease
			? await readOfflineRelease(input.objectStore, currentRelease)
			: null;
		const nextItems = buildNextReleaseItems({
			collectionMode: input.context.collectionMode,
			incoming: input.incomingItems,
			previous: previousManifest?.items ?? [],
			surface: input.context.surface,
		});
		const changes = compareReleaseItems(previousManifest?.items ?? [], nextItems);
		if (
			previousManifest &&
			!hasOfflineReleaseSemanticChange({
				nextCheckpoint: input.nextCheckpoint,
				nextItems,
				previousCheckpoint: previousManifest.checkpoint,
				previousItems: previousManifest.items,
			})
		) {
			const checkedStream = await input.releaseStore.recordCheck({
				check: releaseCheck(input.context, changes, "unchanged"),
				streamId: stream.stream_id,
			});
			return {
				changes,
				outcome: "unchanged",
				release: null,
				stream: checkedStream,
			};
		}
		const releaseId = `release:${input.context.runId}:v${stream.version + 1}`;
		const manifest: IngestionOfflineRelease = {
			checkpoint: input.nextCheckpoint,
			changes: {
				added_item_ids: changes.addedItemIds,
				updated_item_ids: changes.updatedItemIds,
				withdrawn_item_ids: changes.withdrawnItemIds,
			},
			created_at: input.context.startedAt,
			items: nextItems,
			pipeline: {
				code_commit: input.context.codeCommit,
				registry_digest: input.context.registryDigest,
				run_id: input.context.runId,
				source_config_digest: input.sourceConfigDigest,
				task_ids: input.taskIds,
				worker_build_id: input.context.workerBuildId,
				workflow_id: input.context.workflowId,
				workflow_run_id: input.context.workflowRunId,
			},
			previous_release_id: currentRelease?.release_id ?? null,
			release_id: releaseId,
			schema_version: "ingestion_offline_release.v1",
			source: {
				channel: "internal_portal",
				site_id: input.context.siteId,
				surface: input.context.surface,
			},
			stream_id: stream.stream_id,
			target: { collection: stream.collection, corpus: stream.corpus },
		};
		const validation = validateIngestionOfflineRelease(manifest);
		if (!validation.ok) {
			throw ApplicationFailure.nonRetryable(
				`invalid offline ingestion release: ${validation.errors.join("; ")}`,
				"invalid_ingestion_release",
			);
		}
		const manifestRef = await writeOfflineRelease(input.objectStore, manifest);
		try {
			const committed = await input.releaseStore.commitRelease({
				check: releaseCheck(input.context, changes, "published"),
				checkpoint: input.nextCheckpoint,
				expectedStreamVersion: stream.version,
				release: {
					item_count: manifest.items.length,
					manifest_ref: manifestRef,
					previous_release_id: manifest.previous_release_id,
					release_id: manifest.release_id,
					run_id: input.context.runId,
					stream_id: stream.stream_id,
					workflow_id: input.context.workflowId,
					workflow_run_id: input.context.workflowRunId,
				},
			});
			return { changes, outcome: "published", ...committed };
		} catch (error) {
			if (
				!(error instanceof OfflineReleaseConcurrencyError) ||
				input.context.surface === "notice"
			) {
				throw error;
			}
		}
	}
	throw new Error(`offline release stream remained contended: ${input.context.stream.stream_id}`);
}

async function readNoticeSourceConfigDigest(
	objectStore: IngestionObjectStore,
	captureTask: IngestionTaskRecord,
): Promise<string> {
	const capture = await readStageResult(
		objectStore,
		captureTask,
		"internal_portal_notice_capture_result.v1",
	);
	const exportManifestRef = requireSingleRole(capture, "export_manifest");
	const location = parseS3Uri(exportManifestRef);
	const bytes = await objectStore.getObject(location);
	assertArtifactRefBytes({
		bytes,
		label: "internal portal notice export manifest",
		ref: exportManifestRef,
	});
	const manifest = parseJsonObjectBytes(bytes, "internal portal notice export manifest");
	const digest = parseRequiredText(manifest.source_config_digest, "source_config_digest");
	if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
		throw ApplicationFailure.nonRetryable(
			"internal portal notice source config digest is invalid",
			"invalid_ingestion_release",
		);
	}
	return digest;
}

function releaseCheck(
	context: InternalPortalPublicationContext,
	changes: InternalPortalPublicationChanges,
	outcome: "published" | "unchanged",
) {
	return {
		addedCount: changes.addedItemIds.length,
		checkedAt: context.startedAt,
		errorCode: null,
		mode: context.collectionMode,
		outcome,
		updatedCount: changes.updatedItemIds.length,
		withdrawnCount: changes.withdrawnItemIds.length,
	} as const;
}

async function readOfflineRelease(
	objectStore: IngestionObjectStore,
	release: OfflineReleaseRecord,
): Promise<IngestionOfflineRelease> {
	const location = parseS3Uri(release.manifest_ref);
	const bytes = await objectStore.getObject(location);
	assertArtifactRefBytes({ bytes, label: "offline ingestion release", ref: release.manifest_ref });
	const value = parseJsonObjectBytes(bytes, "offline ingestion release");
	const validation = validateIngestionOfflineRelease(value);
	if (!validation.ok) {
		throw ApplicationFailure.nonRetryable(
			`stored offline release violates contract: ${validation.errors.join("; ")}`,
			"invalid_ingestion_release",
		);
	}
	const manifest = value as unknown as IngestionOfflineRelease;
	if (
		manifest.release_id !== release.release_id ||
		manifest.stream_id !== release.stream_id ||
		manifest.pipeline.run_id !== release.run_id
	) {
		throw ApplicationFailure.nonRetryable(
			"stored offline release identity does not match PostgreSQL",
			"invalid_ingestion_release",
		);
	}
	return manifest;
}

async function writeOfflineRelease(
	objectStore: IngestionObjectStore,
	manifest: IngestionOfflineRelease,
): Promise<IngestionArtifactRef> {
	const body = encodeCanonicalJson(manifest);
	const key = [
		"ingestion-releases",
		encodeObjectKeySegment(manifest.stream_id),
		"releases",
		`${encodeObjectKeySegment(manifest.release_id)}.json`,
	].join("/");
	const write = await objectStore.createOrVerifyObject({
		body,
		bucket: objectStore.derivedBucket,
		contentType: "application/json",
		key,
	});
	return buildObjectStoreArtifactRef({
		bucket: objectStore.derivedBucket,
		byteSize: write.byteSize,
		contentSha256: write.contentSha256,
		key,
	});
}

function mergeReleaseItems(
	previous: IngestionOfflineReleaseItem[],
	incoming: IngestionOfflineReleaseItem[],
): IngestionOfflineReleaseItem[] {
	const items = new Map(previous.map((item) => [item.item_id, structuredClone(item)]));
	for (const item of incoming) {
		items.set(item.item_id, structuredClone(item));
	}
	return [...items.values()].sort((left, right) => left.item_id.localeCompare(right.item_id));
}

export function buildNextReleaseItems(input: {
	collectionMode: InternalPortalPublicationContext["collectionMode"];
	incoming: IngestionOfflineReleaseItem[];
	previous: IngestionOfflineReleaseItem[];
	surface: InternalPortalPublicationSurface;
}): IngestionOfflineReleaseItem[] {
	if (input.surface === "notice" && input.collectionMode === "reconcile") {
		return [...input.incoming]
			.map((item) => structuredClone(item))
			.sort((left, right) => left.item_id.localeCompare(right.item_id));
	}
	return mergeReleaseItems(input.previous, input.incoming);
}

export function compareReleaseItems(
	previous: IngestionOfflineReleaseItem[],
	next: IngestionOfflineReleaseItem[],
): InternalPortalPublicationChanges {
	const previousById = new Map(previous.map((item) => [item.item_id, item]));
	const nextById = new Map(next.map((item) => [item.item_id, item]));
	const addedItemIds: string[] = [];
	const updatedItemIds: string[] = [];
	const withdrawnItemIds: string[] = [];
	for (const [itemId, item] of nextById) {
		const prior = previousById.get(itemId);
		if (!prior) {
			addedItemIds.push(itemId);
		} else if (canonicalJsonString(prior) !== canonicalJsonString(item)) {
			updatedItemIds.push(itemId);
		}
	}
	for (const itemId of previousById.keys()) {
		if (!nextById.has(itemId)) {
			withdrawnItemIds.push(itemId);
		}
	}
	return {
		addedItemIds: addedItemIds.sort(),
		updatedItemIds: updatedItemIds.sort(),
		withdrawnItemIds: withdrawnItemIds.sort(),
	};
}

export function hasOfflineReleaseSemanticChange(input: {
	nextCheckpoint: Record<string, unknown>;
	nextItems: IngestionOfflineReleaseItem[];
	previousCheckpoint: Record<string, unknown>;
	previousItems: IngestionOfflineReleaseItem[];
}): boolean {
	return (
		canonicalJsonString(input.previousItems) !== canonicalJsonString(input.nextItems) ||
		canonicalJsonString(input.previousCheckpoint) !== canonicalJsonString(input.nextCheckpoint)
	);
}

function requireCompletedResult(task: IngestionTaskRecord, label: string): IngestionArtifactRef {
	if (task.status !== "completed" || !task.result_ref) {
		throw ApplicationFailure.nonRetryable(
			`${label} task is not completed: ${task.task_id}`,
			"invalid_publication_plan",
		);
	}
	return task.result_ref;
}

function assertTaskBelongsToPublication(
	task: IngestionTaskRecord,
	context: InternalPortalPublicationContext,
): void {
	if (task.run_id !== context.runId || task.pipeline_workflow_id !== context.workflowId) {
		throw ApplicationFailure.nonRetryable(
			`task does not belong to publication workflow: ${task.task_id}`,
			"invalid_publication_plan",
		);
	}
}

function readNoticeCheckpoints(checkpoint: Record<string, unknown>) {
	const value = checkpoint.notices;
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw ApplicationFailure.nonRetryable(
			"notice release checkpoint is invalid",
			"invalid_release_checkpoint",
		);
	}
	const parsed = value.map((item) => {
		if (!(item && typeof item === "object" && !Array.isArray(item))) {
			throw ApplicationFailure.nonRetryable(
				"notice release checkpoint entry is invalid",
				"invalid_release_checkpoint",
			);
		}
		const record = item as Record<string, unknown>;
		if (
			typeof record.notice_type !== "string" ||
			!record.notice_type.trim() ||
			!Number.isSafeInteger(record.last_released_notice_id) ||
			Number(record.last_released_notice_id) < 1
		) {
			throw ApplicationFailure.nonRetryable(
				"notice release checkpoint entry is invalid",
				"invalid_release_checkpoint",
			);
		}
		return {
			last_released_notice_id: Number(record.last_released_notice_id),
			notice_type: record.notice_type.trim(),
		};
	});
	return parsed.sort((left, right) => left.notice_type.localeCompare(right.notice_type));
}

function assertPublicationInput(input: PrepareInternalPortalPublicationInput): void {
	if (!(input.createdBy.trim() && input.runId.trim() && input.workflowId.trim())) {
		throw ApplicationFailure.nonRetryable(
			"publication identity is incomplete",
			"invalid_publication_plan",
		);
	}
	if (input.surface === "file_release") {
		if (!(Number.isSafeInteger(input.fileReleaseId) && Number(input.fileReleaseId) > 0)) {
			throw ApplicationFailure.nonRetryable(
				"file release publication requires an exact positive ID",
				"invalid_publication_plan",
			);
		}
		if (input.collectionMode !== "selected") {
			throw ApplicationFailure.nonRetryable(
				"file release publication must use selected mode",
				"invalid_publication_plan",
			);
		}
	} else if (input.fileReleaseId !== null) {
		throw ApplicationFailure.nonRetryable(
			"notice publication does not accept a file release ID",
			"invalid_publication_plan",
		);
	}
}

function publicationTarget(surface: InternalPortalPublicationSurface): {
	collection: string;
	corpus: string;
} {
	return surface === "notice"
		? { collection: "internal_notice", corpus: "campus_notices" }
		: { collection: "file_release_source", corpus: "authenticated_documents" };
}

export function internalPortalReleaseStreamId(
	siteId: string,
	surface: InternalPortalPublicationSurface,
): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(siteId)) {
		throw new Error("internal portal site ID is invalid");
	}
	return `internal_portal:${siteId}:${surface}`;
}

function childTaskId(runId: string, stage: "capture" | "materialize" | "validate"): string {
	return `${runId}:${stage}`;
}
