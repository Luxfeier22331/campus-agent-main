import { ApplicationFailure, Context } from "@temporalio/activity";
import {
	assertArtifactRefBytes,
	buildObjectStoreArtifactRef,
	encodeObjectKeySegment,
	parseJsonObjectBytes,
	parseS3Uri,
	resolveWeChatOfficialAccountSourceTruthRefsFromTask,
	sha256Hex,
} from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
	IngestionTaskSummaryValue,
	InternalPortalArtifactRole,
	InternalPortalCaptureRequest,
	InternalPortalNoticeCaptureCheckpoint,
} from "ingestion-contracts";
import {
	validateInternalPortalCaptureRequest,
	validateInternalPortalNoticeCheckpoint,
	validateInternalPortalStageResult,
} from "ingestion-contracts";
import { z } from "zod";
import { isPortalSourceDeferredError } from "../adapters/internal-portal/src/api.ts";
import type { AuthenticatedNoticeArtifactStore } from "../adapters/internal-portal/src/artifact-store.ts";
import { isPortalCredentialFailure } from "../adapters/internal-portal/src/auth-errors.ts";
import { resolveInternalPortalConfig } from "../adapters/internal-portal/src/config.ts";
import {
	collectFileReleaseBundle,
	uploadFileReleaseArtifacts,
} from "../adapters/internal-portal/src/file-release-export.ts";
import {
	collectNoticeExportBundle,
	NoticeCheckpointGapError,
	uploadNoticeExportArtifacts,
} from "../adapters/internal-portal/src/notice-export.ts";
import { loadNoticeTypes } from "../adapters/internal-portal/src/notice-types.ts";
import {
	createPortalApiContext,
	refreshPortalAuthentication,
} from "../adapters/internal-portal/src/portal.ts";
import {
	crawlSite,
	type OfficialWebArtifactStore,
	type OfficialWebCrawlCandidate,
} from "../adapters/official-web/src/index.ts";
import { buildWeChatOfficialAccountCaptureRelease } from "../adapters/wechat-official-account/src/capture-release.ts";
import {
	captureFeedWeHistory,
	type WeChatOfficialAccountArtifactStore,
} from "../adapters/wechat-official-account/src/index.ts";
import type { SourceCollectorObjectStore } from "./object-store.ts";

const OfficialWebRequestSchema = z
	.object({
		schema_version: z.literal("official_web_capture_request.v1"),
		site_id: z.string().trim().min(1),
		host_filter: z.array(z.string().trim().min(1)).optional(),
		max_pages_per_host: z.number().int().positive().optional(),
		max_total_pages: z.number().int().positive().optional(),
		run_intent: z.enum(["baseline", "hot", "repair"]).optional(),
	})
	.strict();

const OfficialWebCrawlCandidateSchema = z
	.object({
		cadenceClass: z.string().min(1),
		contentType: z.string().nullable(),
		discoveredFromUrl: z.string().nullable(),
		discoveryMethod: z.enum([
			"seed",
			"robots_sitemap",
			"configured_sitemap",
			"navigation",
			"manual_requeue",
		]),
		etag: z.string().nullable(),
		host: z.string().min(1),
		lastChangeReason: z.string().min(1),
		lastChangedAt: z.string().nullable(),
		lastFetchDisposition: z.enum([
			"fetched",
			"not_modified",
			"deleted",
			"fetch_failed",
			"never_fetched",
		]),
		lastHttpStatus: z.number().int().nullable(),
		lastModified: z.string().nullable(),
		lastNotModifiedAt: z.string().nullable(),
		lastSeenAt: z.string().min(1),
		lastSuccessfulRunId: z.string().nullable(),
		mainContentHash: z.string().nullable(),
		nextEligibleFetchAt: z.string().min(1),
		normalizedCanonicalUrl: z.string().url(),
		pageFamily: z.string().min(1),
		pageTitleNormalized: z.string(),
		priorityScore: z.number(),
		responseBodyHash: z.string().nullable(),
		siteId: z.string().min(1),
	})
	.strict();

const OfficialWebCrawlPreparationSchema = z
	.object({
		schema_version: z.literal("official_web_crawl_preparation.v1"),
		site_id: z.string().min(1),
		prepared_at: z.string().min(1),
		known_seed_urls: z.array(z.string().url()),
		candidates: z.array(OfficialWebCrawlCandidateSchema),
	})
	.strict();

const WeChatRequestSchema = z
	.object({
		schema_version: z.literal("wechat_official_account_capture_request.v1"),
		account_name: z.string().trim().min(1),
		account_slug: z.string().trim().min(1).optional(),
		begin: z.string().trim().min(1).optional(),
		max_articles: z.number().int().positive().default(100),
		max_pages: z.number().int().positive().default(10),
		page_size: z.number().int().positive().max(100).default(20),
	})
	.strict();

export interface SourceCollectorActivityDependencies {
	env: Record<string, string | undefined>;
	objectStore: SourceCollectorObjectStore;
}

export function createSourceCollectorActivities(input: SourceCollectorActivityDependencies) {
	return {
		async refreshInternalPortalAuthentication() {
			try {
				return await refreshPortalAuthentication(resolveInternalPortalConfig(input.env));
			} catch (error) {
				if (isPortalCredentialFailure(error)) {
					throw ApplicationFailure.nonRetryable(error.message, error.code);
				}
				if (isPortalSourceDeferredError(error)) {
					throw ApplicationFailure.create({
						message: error.message,
						nonRetryable: false,
						type: error.code,
					});
				}
				throw error;
			}
		},
		async executeSourceCollectorTask(
			snapshot: IngestionTaskExecutionSnapshot,
			preparationRef: IngestionArtifactRef | null,
		): Promise<IngestionTaskResult> {
			if (snapshot.registry_task.executor_kind !== "source_collector") {
				throw new Error(
					`${snapshot.registry_task.registry_task_id} is not a source collector task`,
				);
			}
			const context = Context.current();
			const activityAttempt = context.info.attempt;
			const heartbeat = (details: unknown) => context.heartbeat(details);
			heartbeat({ phase: "input", task_id: snapshot.task.task_id });
			const abortSignal = context.cancellationSignal;
			const heartbeatTimer = setInterval(() => {
				heartbeat({ phase: "running", task_id: snapshot.task.task_id });
			}, 10_000);
			heartbeatTimer.unref();
			try {
				const request = await readTaskRequest(input.objectStore, snapshot, abortSignal);
				const preparation = preparationRef
					? await readOfficialWebPreparation(input.objectStore, preparationRef, abortSignal)
					: null;
				const collected = await runCollector({
					abortSignal,
					activityAttempt,
					env: input.env,
					heartbeat,
					objectStore: input.objectStore,
					preparation,
					request,
					snapshot,
				});
				abortSignal.throwIfAborted();
				heartbeat({ phase: "result", task_id: snapshot.task.task_id });
				return await writeResultManifest({
					abortSignal,
					activityAttempt,
					artifacts: collected.artifacts,
					objectStore: input.objectStore,
					snapshot,
					summary: collected.summary,
				});
			} catch (error) {
				if (isPortalCredentialFailure(error)) {
					throw ApplicationFailure.nonRetryable(error.message, error.code);
				}
				if (isPortalSourceDeferredError(error)) {
					throw ApplicationFailure.create({
						message: error.message,
						nonRetryable: false,
						type: error.code,
					});
				}
				if (error instanceof NoticeCheckpointGapError) {
					throw ApplicationFailure.nonRetryable(error.message, "checkpoint_gap", {
						gaps: error.gaps,
					});
				}
				throw error;
			} finally {
				clearInterval(heartbeatTimer);
			}
		},
	};
}

async function readTaskRequest(
	objectStore: SourceCollectorObjectStore,
	snapshot: IngestionTaskExecutionSnapshot,
	abortSignal: AbortSignal,
): Promise<Record<string, unknown>> {
	const location = parseS3Uri(snapshot.task.input_ref);
	const bytes = await objectStore.getObject({ ...location, abortSignal });
	abortSignal.throwIfAborted();
	assertArtifactRefBytes({
		bytes,
		label: "source collector input_ref",
		ref: snapshot.task.input_ref,
	});
	return parseJsonObjectBytes(bytes, "source collector request");
}

async function readOfficialWebPreparation(
	objectStore: SourceCollectorObjectStore,
	ref: IngestionArtifactRef,
	abortSignal: AbortSignal,
): Promise<z.infer<typeof OfficialWebCrawlPreparationSchema>> {
	const location = parseS3Uri(ref);
	const bytes = await objectStore.getObject({ ...location, abortSignal });
	abortSignal.throwIfAborted();
	assertArtifactRefBytes({
		bytes,
		label: "official-web crawl preparation",
		ref,
	});
	return OfficialWebCrawlPreparationSchema.parse(
		parseJsonObjectBytes(bytes, "official-web crawl preparation"),
	);
}

async function runCollector(input: {
	abortSignal: AbortSignal;
	activityAttempt: number;
	env: Record<string, string | undefined>;
	heartbeat: (details: unknown) => void;
	objectStore: SourceCollectorObjectStore;
	preparation: z.infer<typeof OfficialWebCrawlPreparationSchema> | null;
	request: Record<string, unknown>;
	snapshot: IngestionTaskExecutionSnapshot;
}): Promise<{
	artifacts: Array<IngestionArtifactRef & { role?: InternalPortalArtifactRole }>;
	summary: Record<string, IngestionTaskSummaryValue>;
}> {
	switch (input.snapshot.task.registry_task_id) {
		case "official_web.capture":
			return runOfficialWebCollector(input);
		case "internal_portal.notice.capture":
			return runInternalNoticeCollector(input);
		case "internal_portal.file_release.capture":
			return runFileReleaseCollector(input);
		case "wechat_official_account.capture":
			return runWeChatCollector(input);
		default:
			throw new Error(
				`source collector handler is not registered: ${input.snapshot.task.registry_task_id}`,
			);
	}
}

async function runOfficialWebCollector(input: Parameters<typeof runCollector>[0]) {
	const request = OfficialWebRequestSchema.parse(input.request);
	if (input.preparation && input.preparation.site_id !== request.site_id) {
		throw new Error("official-web crawl preparation site_id does not match request");
	}
	const artifactStore = createOfficialWebArtifactStore(input.objectStore);
	try {
		const result = await crawlSite(request.site_id, {
			abortSignal: input.abortSignal,
			activityAttempt: input.activityAttempt,
			artifactStore,
			configRoot: input.env.OFFICIAL_WEB_CONFIG_ROOT,
			crawlRunId: input.snapshot.task.run_id,
			crawlCandidates: input.preparation?.candidates.map(toOfficialWebCrawlCandidate),
			freshnessKnownSeedUrls: input.preparation?.known_seed_urls,
			hostFilter: request.host_filter,
			maxPagesPerHost: request.max_pages_per_host,
			maxTotalPages: request.max_total_pages,
			runIntent: request.run_intent,
			reportProgress: async (counts) => {
				input.abortSignal.throwIfAborted();
				input.heartbeat({ phase: "crawl", ...counts });
			},
		});
		return {
			artifacts: result.uploadedArtifacts.map((artifact) =>
				buildObjectStoreArtifactRef({
					bucket: input.objectStore.sourceBucket,
					byteSize: artifact.byteSize,
					key: artifact.objectKey,
					contentSha256: artifact.contentSha256,
				}),
			),
			summary: {
				failure_count: result.failures.length,
				page_count: result.pages.length,
				url_count: result.urlResults.length,
			},
		};
	} finally {
		await artifactStore.close?.();
	}
}

function toOfficialWebCrawlCandidate(
	candidate: z.infer<typeof OfficialWebCrawlCandidateSchema>,
): OfficialWebCrawlCandidate {
	const sourceIdentity = `source:${candidate.normalizedCanonicalUrl}`;
	return {
		...candidate,
		configuredSeedUrl: null,
		consumerFamily: "source_inventory",
		fetchProfile: "freshness",
		hostPolicy: { host: candidate.host, sourceHost: candidate.host },
		inventoryOnly: true,
		materializationPolicy: "inventory_only",
		retentionPolicy: "retain_source_truth",
		reviewPolicy: "manual",
		selectedWriteTarget: "",
		targetCandidateId: null,
		targetDeclarationVersion: "official_web_freshness.v1",
		targetId: sourceIdentity,
		targetJobId: sourceIdentity,
		worksetReason: "freshness_due",
	};
}

async function runInternalNoticeCollector(input: Parameters<typeof runCollector>[0]) {
	const request = parseInternalPortalCaptureRequest(
		input.request,
		"internal_portal_notice_capture_request.v2",
	);
	const config = resolveInternalPortalConfig(input.env);
	const artifactStore = createAuthenticatedNoticeArtifactStore(input.objectStore);
	try {
		const exportedAt = new Date().toISOString();
		const collected = await collectNoticeExportBundle({
			abortSignal: input.abortSignal,
			attachmentArtifactStore: artifactStore,
			reconcileMaxPagesPerType: config.reconcileMaxPagesPerType,
			collectionMode: request.collection_mode,
			checkpoints: request.checkpoints,
			createApiContext: () => createPortalApiContext(config),
			exportedAt,
			maxNotices: request.max_notices,
			overlapPages: request.overlap_pages,
			noticeTypes: loadNoticeTypes(config.noticeTypesPath),
			requestMaxRetries: config.requestMaxRetries,
			selectedNotices: request.selected_notices?.map((notice) => ({
				noticeId: notice.notice_id,
				noticeType: notice.notice_type,
				noticeTypeName: notice.notice_type_name,
				noticeTitle: notice.notice_title,
			})),
			siteId: config.siteId,
			sourceHomeUrl: config.sourceHomeUrl,
		});
		input.abortSignal.throwIfAborted();
		const uploaded = await uploadNoticeExportArtifacts({
			abortSignal: input.abortSignal,
			activityAttempt: input.activityAttempt,
			artifactStore,
			bundleRecords: collected.bundleRecords,
			exportedAt,
			exportManifest: collected.exportManifest,
			runId: input.snapshot.task.run_id,
			siteId: config.siteId,
		});
		const checkpointRef = await writeNoticeCheckpointArtifact({
			abortSignal: input.abortSignal,
			activityAttempt: input.activityAttempt,
			capturedAt: exportedAt,
			checkpoint: collected.checkpoint,
			objectStore: input.objectStore,
			runId: input.snapshot.task.run_id,
			siteId: config.siteId,
		});
		input.abortSignal.throwIfAborted();
		return {
			artifacts: [
				{
					...buildObjectStoreArtifactRef({
						bucket: uploaded.sourceBucket,
						byteSize: uploaded.captureReleaseByteSize,
						key: uploaded.captureReleaseObjectKey,
						contentSha256: uploaded.captureReleaseContentSha256,
					}),
					role: "capture_release" as const,
				},
				{ ...checkpointRef, role: "capture_checkpoint" as const },
			],
			summary: {
				attachment_count: collected.stats.attachmentObjectsUploaded,
				notice_count: collected.stats.noticesCollected,
				page_count: collected.stats.pagesFetched,
			},
		};
	} finally {
		await artifactStore.close?.();
	}
}

async function writeNoticeCheckpointArtifact(input: {
	abortSignal: AbortSignal;
	activityAttempt: number;
	capturedAt: string;
	checkpoint: {
		previous: InternalPortalNoticeCaptureCheckpoint["previous"];
		next: InternalPortalNoticeCaptureCheckpoint["next"];
	};
	objectStore: SourceCollectorObjectStore;
	runId: string;
	siteId: string;
}): Promise<IngestionArtifactRef> {
	const checkpoint: InternalPortalNoticeCaptureCheckpoint = {
		captured_at: input.capturedAt,
		next: input.checkpoint.next,
		previous: input.checkpoint.previous,
		schema_version: "internal_portal_notice_checkpoint.v1",
	};
	const validation = validateInternalPortalNoticeCheckpoint(checkpoint);
	if (!validation.ok) {
		throw new Error(`notice checkpoint violates contract: ${validation.errors.join("; ")}`);
	}
	const body = new TextEncoder().encode(`${JSON.stringify(checkpoint, null, 2)}\n`);
	const key = [
		"attempts",
		"internal_portal",
		encodeObjectKeySegment(input.siteId),
		"runs",
		encodeObjectKeySegment(input.runId),
		String(input.activityAttempt),
		"notice",
		"checkpoint.json",
	].join("/");
	const write = await input.objectStore.createOrVerifyObject({
		abortSignal: input.abortSignal,
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

async function runFileReleaseCollector(input: Parameters<typeof runCollector>[0]) {
	const request = parseInternalPortalCaptureRequest(
		input.request,
		"internal_portal_file_release_capture_request.v2",
	);
	const config = resolveInternalPortalConfig(input.env);
	const artifactStore = createAuthenticatedNoticeArtifactStore(input.objectStore);
	try {
		const exportedAt = new Date().toISOString();
		const collected = await collectFileReleaseBundle({
			abortSignal: input.abortSignal,
			attachmentArtifactStore: artifactStore,
			createApiContext: () => createPortalApiContext(config),
			exportedAt,
			maxFileReleases: 1,
			maxPages: null,
			pageSize: 20,
			requestMaxRetries: config.requestMaxRetries,
			siteId: config.siteId,
			sourceHomeUrl: config.sourceHomeUrl,
			targetFileReleaseId: request.file_release_id,
		});
		input.abortSignal.throwIfAborted();
		const uploaded = await uploadFileReleaseArtifacts({
			abortSignal: input.abortSignal,
			activityAttempt: input.activityAttempt,
			artifactStore,
			bundleRecords: collected.bundleRecords,
			exportedAt,
			exportManifest: collected.exportManifest,
			runId: input.snapshot.task.run_id,
			siteId: config.siteId,
		});
		input.abortSignal.throwIfAborted();
		return {
			artifacts: [
				{
					...buildObjectStoreArtifactRef({
						bucket: uploaded.sourceBucket,
						byteSize: uploaded.bundleByteSize,
						key: uploaded.bundleObjectKey,
						contentSha256: uploaded.bundleContentSha256,
					}),
					role: "source_bundle" as const,
				},
				{
					...buildObjectStoreArtifactRef({
						bucket: uploaded.sourceBucket,
						byteSize: uploaded.manifestByteSize,
						key: uploaded.manifestObjectKey,
						contentSha256: uploaded.manifestContentSha256,
					}),
					role: "export_manifest" as const,
				},
			],
			summary: {
				file_count: collected.stats.fileReleasesCollected,
				page_count: collected.stats.pagesFetched,
				upload_count: collected.stats.fileObjectsUploaded,
			},
		};
	} finally {
		await artifactStore.close?.();
	}
}

async function runWeChatCollector(input: Parameters<typeof runCollector>[0]) {
	const request = WeChatRequestSchema.parse(input.request);
	const artifactStore = createWeChatOfficialAccountArtifactStore(input.objectStore);
	try {
		const result = await captureFeedWeHistory({
			abortSignal: input.abortSignal,
			activityAttempt: input.activityAttempt,
			accountName: request.account_name,
			accountSlug: request.account_slug,
			captureRunId: input.snapshot.task.run_id,
			artifactStore,
			begin: request.begin,
			maxArticles: request.max_articles,
			maxPages: request.max_pages,
			provider: {
				baseUrl: input.env.FEEDWE_BASE_URL?.trim() || "https://www.feedwe.top",
				email: requiredEnv(input.env, "FEEDWE_EMAIL"),
				password: requiredEnv(input.env, "FEEDWE_PASSWORD"),
			},
			size: request.page_size,
		});
		input.abortSignal.throwIfAborted();
		const release = buildWeChatOfficialAccountCaptureRelease({
			accountSlug: result.accountSlug,
			artifacts: result.artifacts,
			capturedAt: new Date().toISOString(),
			captureRunId: input.snapshot.task.run_id,
			sourceBucket: input.objectStore.sourceBucket,
		});
		const releaseBytes = new TextEncoder().encode(`${JSON.stringify(release, null, 2)}\n`);
		const releaseKey = [
			"wechat_official_account",
			encodeObjectKeySegment(result.accountSlug),
			"runs",
			encodeObjectKeySegment(input.snapshot.task.run_id),
			"attempts",
			String(input.activityAttempt),
			"capture-release.json",
		].join("/");
		await input.objectStore.createOrVerifyObject({
			abortSignal: input.abortSignal,
			bucket: input.objectStore.sourceBucket,
			key: releaseKey,
			body: releaseBytes,
			contentType: "application/json",
		});
		input.abortSignal.throwIfAborted();
		const artifacts = await resolveWeChatOfficialAccountSourceTruthRefsFromTask({
			objectStore: bindObjectStoreCancellation(input.objectStore, input.abortSignal),
			task: {
				...input.snapshot.task,
				input_ref: buildObjectStoreArtifactRef({
					bucket: input.objectStore.sourceBucket,
					byteSize: releaseBytes.byteLength,
					key: releaseKey,
					contentSha256: sha256Hex(releaseBytes),
				}),
			},
		});
		input.abortSignal.throwIfAborted();
		return { artifacts, summary: result.summary };
	} finally {
		await artifactStore.close?.();
	}
}

async function writeResultManifest(input: {
	abortSignal: AbortSignal;
	activityAttempt: number;
	artifacts: IngestionArtifactRef[];
	objectStore: SourceCollectorObjectStore;
	snapshot: IngestionTaskExecutionSnapshot;
	summary: Record<string, IngestionTaskSummaryValue>;
}): Promise<IngestionTaskResult> {
	const manifest = {
		schema_version: input.snapshot.registry_task.output_contract,
		task_id: input.snapshot.task.task_id,
		run_id: input.snapshot.task.run_id,
		registry_task_id: input.snapshot.task.registry_task_id,
		artifacts: input.artifacts,
		summary: input.summary,
	};
	if (input.snapshot.registry_task.output_contract.startsWith("internal_portal_")) {
		const validation = validateInternalPortalStageResult(manifest);
		if (!validation.ok) {
			throw new Error(
				`source collector stage result violates contract: ${validation.errors.join("; ")}`,
			);
		}
	}
	const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
	input.abortSignal.throwIfAborted();
	const key = [
		"ingestion-results",
		encodeObjectKeySegment(input.snapshot.task.registry_task_id),
		"runs",
		encodeObjectKeySegment(input.snapshot.task.run_id),
		"attempts",
		String(input.activityAttempt),
		`${encodeObjectKeySegment(input.snapshot.task.task_id)}.json`,
	].join("/");
	const write = await input.objectStore.createOrVerifyObject({
		abortSignal: input.abortSignal,
		bucket: input.objectStore.sourceBucket,
		key,
		body: bytes,
		contentType: "application/json",
	});
	input.abortSignal.throwIfAborted();
	return {
		schema_version: "ingestion_task_result.v1",
		task_id: input.snapshot.task.task_id,
		run_id: input.snapshot.task.run_id,
		registry_task_id: input.snapshot.task.registry_task_id,
		output_contract: input.snapshot.registry_task.output_contract,
		result_ref: buildObjectStoreArtifactRef({
			bucket: input.objectStore.sourceBucket,
			byteSize: write.byteSize,
			key,
			contentSha256: write.contentSha256,
		}),
		summary: input.summary,
	};
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function parseInternalPortalCaptureRequest<
	SchemaVersion extends InternalPortalCaptureRequest["schema_version"],
>(
	value: Record<string, unknown>,
	schemaVersion: SchemaVersion,
): Extract<InternalPortalCaptureRequest, { schema_version: SchemaVersion }> {
	const validation = validateInternalPortalCaptureRequest(value);
	if (!validation.ok) {
		throw new Error(`internal portal capture request is invalid: ${validation.errors.join("; ")}`);
	}
	if (value.schema_version !== schemaVersion) {
		throw new Error(`internal portal capture request must use ${schemaVersion}`);
	}
	return value as unknown as Extract<
		InternalPortalCaptureRequest,
		{ schema_version: SchemaVersion }
	>;
}

function createOfficialWebArtifactStore(
	objectStore: SourceCollectorObjectStore,
): OfficialWebArtifactStore {
	return {
		async createOrVerifyObject(input) {
			const stored = await objectStore.createOrVerifyObject({
				abortSignal: input.abortSignal,
				body: input.data,
				bucket: objectStore.sourceBucket,
				contentType: input.contentType,
				key: input.objectKey,
			});
			return {
				byteSize: stored.byteSize,
				contentSha256: stored.contentSha256,
				etag: stored.etag,
				objectKey: input.objectKey,
				recordCount: input.recordCount,
				versionId: stored.versionId,
			};
		},
	};
}

function createWeChatOfficialAccountArtifactStore(
	objectStore: SourceCollectorObjectStore,
): WeChatOfficialAccountArtifactStore {
	return createOfficialWebArtifactStore(objectStore);
}

function createAuthenticatedNoticeArtifactStore(
	objectStore: SourceCollectorObjectStore,
): AuthenticatedNoticeArtifactStore {
	return {
		storageProvider: "object_store",
		async createOrVerifyObject(input) {
			const stored = await objectStore.createOrVerifyObject({
				abortSignal: input.abortSignal,
				body: input.data,
				bucket: objectStore.sourceBucket,
				contentType: input.contentType,
				key: input.objectKey,
				metadata: input.metadata,
			});
			return {
				bucket: objectStore.sourceBucket,
				byteSize: stored.byteSize,
				contentSha256: stored.contentSha256,
				etag: stored.etag,
				objectKey: input.objectKey,
				versionId: stored.versionId,
			};
		},
		async headObject(input) {
			const stored = await objectStore.headObject({
				abortSignal: input.abortSignal,
				bucket: objectStore.sourceBucket,
				key: input.objectKey,
			});
			return {
				...stored,
				bucket: objectStore.sourceBucket,
				objectKey: input.objectKey,
			};
		},
	};
}

function bindObjectStoreCancellation(
	objectStore: SourceCollectorObjectStore,
	abortSignal: AbortSignal,
): SourceCollectorObjectStore {
	return {
		sourceBucket: objectStore.sourceBucket,
		async getObject(input) {
			abortSignal.throwIfAborted();
			const bytes = await objectStore.getObject({ ...input, abortSignal });
			abortSignal.throwIfAborted();
			return bytes;
		},
		async headObject(input) {
			abortSignal.throwIfAborted();
			const result = await objectStore.headObject({ ...input, abortSignal });
			abortSignal.throwIfAborted();
			return result;
		},
		async createOrVerifyObject(input) {
			abortSignal.throwIfAborted();
			const result = await objectStore.createOrVerifyObject({ ...input, abortSignal });
			abortSignal.throwIfAborted();
			return result;
		},
	};
}
