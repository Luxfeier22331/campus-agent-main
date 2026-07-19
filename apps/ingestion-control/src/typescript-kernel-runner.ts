import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	assertArtifactRefBytes,
	buildObjectStoreArtifactRef,
	encodeObjectKeySegment,
	materializeAuthenticatedFileReleaseSourceTruthFromTask,
	materializeAuthenticatedNoticeSourceTruthFromTask,
	parseAuthenticatedNoticeNoticeFamilyConfig,
	parseJsonObjectBytes,
	parseS3Uri,
} from "ingest-core";
import type {
	IngestionArtifactRef,
	IngestionOfflineReleaseItem,
	IngestionRoleArtifactRef,
	IngestionTaskExecutionSnapshot,
	IngestionTaskResult,
	InternalPortalStageResultManifest,
} from "ingestion-contracts";
import { validateInternalPortalStageResult } from "ingestion-contracts";
import type { IngestionObjectStore } from "./object-store";

export type TypeScriptKernelHandler = (
	snapshot: IngestionTaskExecutionSnapshot,
	options: { activityAttempt: number; signal?: AbortSignal },
) => Promise<IngestionTaskResult>;

export class TypeScriptKernelRegistry {
	readonly #handlers = new Map<string, TypeScriptKernelHandler>();

	register(kernelId: string, handler: TypeScriptKernelHandler): void {
		if (this.#handlers.has(kernelId)) {
			throw new Error(`TypeScript kernel already registered: ${kernelId}`);
		}
		this.#handlers.set(kernelId, handler);
	}

	has(kernelId: string): boolean {
		return this.#handlers.has(kernelId);
	}

	require(snapshot: IngestionTaskExecutionSnapshot): TypeScriptKernelHandler {
		if (snapshot.registry_task.executor_kind !== "typescript_kernel") {
			throw new Error(`${snapshot.task.registry_task_id} is not a TypeScript kernel task`);
		}
		const kernelId = snapshot.registry_task.kernel_id;
		if (!kernelId) {
			throw new Error(`${snapshot.task.registry_task_id} is missing kernel_id`);
		}
		const handler = this.#handlers.get(kernelId);
		if (!handler) {
			throw new Error(`TypeScript kernel is not registered: ${kernelId}`);
		}
		return handler;
	}
}

export function createDefaultTypeScriptKernelRegistry(input: {
	objectStore: IngestionObjectStore;
	registryRoot: string;
}): TypeScriptKernelRegistry {
	const registry = new TypeScriptKernelRegistry();
	const noticeFamilyConfig = parseAuthenticatedNoticeNoticeFamilyConfig(
		JSON.parse(
			readFileSync(
				join(
					input.registryRoot,
					"campus_notices",
					"internal_notice",
					"notice-family-classification.v1.json",
				),
				"utf8",
			),
		),
	);

	registry.register("materialize-internal-portal-notice", async (snapshot, options) => {
		const capture = await readStageResult(input.objectStore, snapshot, options.signal);
		const captureRelease = requireRole(capture, "capture_release");
		const refs = await materializeAuthenticatedNoticeSourceTruthFromTask({
			noticeFamilyConfig,
			objectStore: bindAbortSignal(input.objectStore, options.signal),
			outputBucket: input.objectStore.derivedBucket,
			task: { ...snapshot.task, input_ref: captureRelease },
		});
		const selected = await selectNoticeArtifacts({
			objectStore: input.objectStore,
			refs,
			signal: options.signal,
		});
		const aggregate = await writeAggregateDocumentUnits({
			activityAttempt: options.activityAttempt,
			objectStore: input.objectStore,
			refs: selected.documentUnitRefs,
			signal: options.signal,
			snapshot,
		});
		return writeStageResult({
			activityAttempt: options.activityAttempt,
			artifacts: [{ ...aggregate, role: "canonical_document_units" }],
			items: selected.items,
			objectStore: input.objectStore,
			signal: options.signal,
			snapshot,
			summary: {
				artifact_count: selected.itemArtifactCount + 1,
				document_count: selected.documentUnitRefs.length,
			},
		});
	});

	registry.register("materialize-internal-portal-file-release", async (snapshot, options) => {
		const capture = await readStageResult(input.objectStore, snapshot, options.signal);
		const exportManifest = requireRole(capture, "export_manifest");
		const refs = await materializeAuthenticatedFileReleaseSourceTruthFromTask({
			objectStore: bindAbortSignal(input.objectStore, options.signal),
			outputBucket: input.objectStore.derivedBucket,
			task: { ...snapshot.task, input_ref: exportManifest },
		});
		const selected = await selectFileReleaseArtifacts({
			objectStore: input.objectStore,
			refs,
			signal: options.signal,
		});
		return writeStageResult({
			activityAttempt: options.activityAttempt,
			artifacts: selected.artifacts,
			items: selected.items,
			objectStore: input.objectStore,
			signal: options.signal,
			snapshot,
			summary: { artifact_count: selected.artifacts.length, file_count: selected.items.length },
		});
	});

	return registry;
}

export function assertTypeScriptKernelRegistryCoversTasks(
	tasks: readonly { executor_kind: string; kernel_id?: string }[],
	registry: TypeScriptKernelRegistry,
): void {
	const missing = tasks.flatMap((task) => {
		if (task.executor_kind !== "typescript_kernel") {
			return [];
		}
		const kernelId = task.kernel_id?.trim();
		if (!kernelId) {
			return ["<missing kernel_id>"];
		}
		return registry.has(kernelId) ? [] : [kernelId];
	});
	if (missing.length > 0) {
		throw new Error(`TypeScript kernel registry is missing handlers: ${missing.join(", ")}`);
	}
}

async function readStageResult(
	objectStore: IngestionObjectStore,
	snapshot: IngestionTaskExecutionSnapshot,
	signal?: AbortSignal,
): Promise<InternalPortalStageResultManifest> {
	const location = parseS3Uri(snapshot.task.input_ref);
	const bytes = await objectStore.getObject({ ...location, abortSignal: signal });
	signal?.throwIfAborted();
	assertArtifactRefBytes({
		bytes,
		label: "TypeScript kernel input_ref",
		ref: snapshot.task.input_ref,
	});
	const value = parseJsonObjectBytes(bytes, "TypeScript kernel stage result");
	return parseTypeScriptKernelInputStageResult(value, snapshot);
}

export function parseTypeScriptKernelInputStageResult(
	value: Record<string, unknown>,
	snapshot: IngestionTaskExecutionSnapshot,
): InternalPortalStageResultManifest {
	const validation = validateInternalPortalStageResult(value);
	if (!validation.ok) {
		throw new Error(
			`TypeScript kernel input violates stage result contract: ${validation.errors.join("; ")}`,
		);
	}
	if (value.schema_version !== snapshot.registry_task.input_contract) {
		throw new Error("TypeScript kernel input schema does not match frozen input contract");
	}
	const expectedProducer = expectedProducerRegistryTaskId(snapshot.registry_task.input_contract);
	if (value.run_id !== snapshot.task.run_id || value.registry_task_id !== expectedProducer) {
		throw new Error("TypeScript kernel input identity does not match its task");
	}
	return value as unknown as InternalPortalStageResultManifest;
}

function expectedProducerRegistryTaskId(inputContract: string): string {
	switch (inputContract) {
		case "internal_portal_notice_capture_result.v1":
			return "internal_portal.notice.capture";
		case "internal_portal_file_release_capture_result.v1":
			return "internal_portal.file_release.capture";
		default:
			throw new Error(`unsupported TypeScript kernel input contract: ${inputContract}`);
	}
}

function requireRole(
	manifest: InternalPortalStageResultManifest,
	role: IngestionRoleArtifactRef["role"],
): IngestionArtifactRef {
	const matches = manifest.artifacts.filter((artifact) => artifact.role === role);
	if (matches.length !== 1) {
		throw new Error(`stage result must contain exactly one ${role} artifact`);
	}
	const { role: _role, ...ref } = matches[0] as IngestionRoleArtifactRef;
	return ref;
}

async function selectNoticeArtifacts(input: {
	objectStore: IngestionObjectStore;
	refs: IngestionArtifactRef[];
	signal?: AbortSignal;
}): Promise<{
	documentUnitRefs: IngestionArtifactRef[];
	itemArtifactCount: number;
	items: IngestionOfflineReleaseItem[];
}> {
	const artifacts: IngestionRoleArtifactRef[] = [];
	const documentUnitRefs: IngestionArtifactRef[] = [];
	for (const ref of input.refs) {
		const path = new URL(ref.uri).pathname;
		if (path.endsWith("/source-truth/notice-manifest.json")) {
			artifacts.push({ ...ref, role: "source_manifest" });
		} else if (path.endsWith("/source-truth/content-blocks.jsonl")) {
			artifacts.push({ ...ref, role: "content_blocks" });
		} else if (path.endsWith("/source-truth/attachment-refs.jsonl")) {
			artifacts.push({ ...ref, role: "attachment_refs" });
		} else if (path.endsWith("/canonical/canonical.md")) {
			artifacts.push({ ...ref, role: "canonical_markdown" });
		} else if (path.endsWith("/canonical/document-units.jsonl")) {
			documentUnitRefs.push(ref);
		}
	}
	if (documentUnitRefs.length === 0) {
		throw new Error("notice materialization produced no canonical document units");
	}
	const items = await buildReleaseItemsFromSourceManifests({
		artifacts: [
			...artifacts,
			...documentUnitRefs.map((ref) => ({ ...ref, role: "canonical_document_units" as const })),
		],
		manifestFilename: "notice-manifest.json",
		objectStore: input.objectStore,
		signal: input.signal,
	});
	return {
		documentUnitRefs,
		itemArtifactCount: artifacts.length + documentUnitRefs.length,
		items,
	};
}

async function selectFileReleaseArtifacts(input: {
	objectStore: IngestionObjectStore;
	refs: IngestionArtifactRef[];
	signal?: AbortSignal;
}): Promise<{
	artifacts: IngestionRoleArtifactRef[];
	items: IngestionOfflineReleaseItem[];
}> {
	const artifacts: IngestionRoleArtifactRef[] = [];
	for (const ref of input.refs) {
		const path = new URL(ref.uri).pathname;
		if (path.endsWith("/source-truth/file-release-manifest.json")) {
			artifacts.push({ ...ref, role: "source_manifest" });
		} else if (path.endsWith("/source-truth/content-blocks.jsonl")) {
			artifacts.push({ ...ref, role: "content_blocks" });
		} else if (path.endsWith("/source-truth/released-file-ref.json")) {
			artifacts.push({ ...ref, role: "released_file" });
		}
	}
	if (!artifacts.some((artifact) => artifact.role === "released_file")) {
		throw new Error("file-release materialization produced no released file ref");
	}
	return {
		artifacts,
		items: await buildReleaseItemsFromSourceManifests({
			artifacts,
			manifestFilename: "file-release-manifest.json",
			objectStore: input.objectStore,
			signal: input.signal,
		}),
	};
}

async function buildReleaseItemsFromSourceManifests(input: {
	artifacts: IngestionRoleArtifactRef[];
	manifestFilename: "file-release-manifest.json" | "notice-manifest.json";
	objectStore: IngestionObjectStore;
	signal?: AbortSignal;
}): Promise<IngestionOfflineReleaseItem[]> {
	const manifests = input.artifacts.filter(
		(artifact) =>
			artifact.role === "source_manifest" &&
			new URL(artifact.uri).pathname.endsWith(`/source-truth/${input.manifestFilename}`),
	);
	if (manifests.length === 0) {
		throw new Error(`materialization produced no ${input.manifestFilename}`);
	}
	const artifactsByRoot = new Map<string, IngestionRoleArtifactRef[]>();
	for (const artifact of input.artifacts) {
		const location = parseS3Uri(artifact);
		const rootKey = materializedArtifactRootKey(location.key);
		if (!rootKey) {
			continue;
		}
		const identity = `${location.bucket}\0${rootKey}`;
		const grouped = artifactsByRoot.get(identity) ?? [];
		grouped.push(artifact);
		artifactsByRoot.set(identity, grouped);
	}
	const items: IngestionOfflineReleaseItem[] = [];
	for (const manifestRef of manifests) {
		const location = parseS3Uri(manifestRef);
		const marker = `/source-truth/${input.manifestFilename}`;
		if (!location.key.endsWith(marker)) {
			throw new Error(`source manifest key does not end with ${marker}`);
		}
		const rootKey = location.key.slice(0, -marker.length);
		const bytes = await input.objectStore.getObject({ ...location, abortSignal: input.signal });
		assertArtifactRefBytes({ bytes, label: "materialized source manifest", ref: manifestRef });
		const manifest = parseJsonObjectBytes(bytes, "materialized source manifest");
		const itemId = requiredIdentity(manifest.raw_asset_id, "raw_asset_id");
		const versionId = requiredVersionId(manifest.raw_version_id);
		const itemArtifacts = artifactsByRoot.get(`${location.bucket}\0${rootKey}`) ?? [];
		if (itemArtifacts.length === 0) {
			throw new Error(`materialized item has no artifacts: ${itemId}`);
		}
		items.push({ artifacts: itemArtifacts, item_id: itemId, version_id: versionId });
	}
	return items.sort((left, right) => left.item_id.localeCompare(right.item_id));
}

function materializedArtifactRootKey(key: string): string | null {
	for (const marker of ["/source-truth/", "/canonical/"]) {
		const markerIndex = key.indexOf(marker);
		if (markerIndex > 0) {
			return key.slice(0, markerIndex);
		}
	}
	return null;
}

function requiredIdentity(value: unknown, label: string): string {
	if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
		throw new Error(`materialized source manifest ${label} is invalid`);
	}
	return value;
}

function requiredVersionId(value: unknown): string {
	if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
		throw new Error("materialized source manifest raw_version_id is invalid");
	}
	return value;
}

async function writeAggregateDocumentUnits(input: {
	activityAttempt: number;
	objectStore: IngestionObjectStore;
	refs: IngestionArtifactRef[];
	signal?: AbortSignal;
	snapshot: IngestionTaskExecutionSnapshot;
}): Promise<IngestionArtifactRef> {
	const chunks: string[] = [];
	for (const ref of [...input.refs].sort((left, right) => left.uri.localeCompare(right.uri))) {
		const location = parseS3Uri(ref);
		const bytes = await input.objectStore.getObject({ ...location, abortSignal: input.signal });
		assertArtifactRefBytes({ bytes, label: "materialized document units", ref });
		chunks.push(new TextDecoder().decode(bytes).trim());
	}
	const body = new TextEncoder().encode(`${chunks.filter(Boolean).join("\n")}\n`);
	const key = kernelArtifactKey(input.snapshot, input.activityAttempt, "document-units.jsonl");
	const write = await input.objectStore.createOrVerifyObject({
		abortSignal: input.signal,
		body,
		bucket: input.objectStore.derivedBucket,
		contentType: "application/x-ndjson",
		key,
	});
	return buildObjectStoreArtifactRef({
		bucket: input.objectStore.derivedBucket,
		byteSize: write.byteSize,
		contentSha256: write.contentSha256,
		key,
	});
}

async function writeStageResult(input: {
	activityAttempt: number;
	artifacts: IngestionRoleArtifactRef[];
	items?: IngestionOfflineReleaseItem[];
	objectStore: IngestionObjectStore;
	signal?: AbortSignal;
	snapshot: IngestionTaskExecutionSnapshot;
	summary: Record<string, number | string | boolean | null>;
}): Promise<IngestionTaskResult> {
	const manifest: InternalPortalStageResultManifest = {
		artifacts: input.artifacts,
		...(input.items ? { items: input.items } : {}),
		registry_task_id: input.snapshot.task.registry_task_id,
		run_id: input.snapshot.task.run_id,
		schema_version: input.snapshot.registry_task
			.output_contract as InternalPortalStageResultManifest["schema_version"],
		summary: input.summary,
		task_id: input.snapshot.task.task_id,
	};
	const validation = validateInternalPortalStageResult(manifest);
	if (!validation.ok) {
		throw new Error(
			`TypeScript kernel output violates stage result contract: ${validation.errors.join("; ")}`,
		);
	}
	const body = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
	const key = kernelArtifactKey(input.snapshot, input.activityAttempt, "result.json");
	const write = await input.objectStore.createOrVerifyObject({
		abortSignal: input.signal,
		body,
		bucket: input.objectStore.derivedBucket,
		contentType: "application/json",
		key,
	});
	return {
		output_contract: input.snapshot.registry_task.output_contract,
		registry_task_id: input.snapshot.task.registry_task_id,
		result_ref: buildObjectStoreArtifactRef({
			bucket: input.objectStore.derivedBucket,
			byteSize: write.byteSize,
			contentSha256: write.contentSha256,
			key,
		}),
		run_id: input.snapshot.task.run_id,
		schema_version: "ingestion_task_result.v1",
		summary: input.summary,
		task_id: input.snapshot.task.task_id,
	};
}

function kernelArtifactKey(
	snapshot: IngestionTaskExecutionSnapshot,
	activityAttempt: number,
	filename: string,
): string {
	return [
		"ingestion-typescript-kernels",
		encodeObjectKeySegment(snapshot.registry_task.kernel_id ?? "unknown"),
		"runs",
		encodeObjectKeySegment(snapshot.task.run_id),
		"attempts",
		String(activityAttempt),
		encodeObjectKeySegment(snapshot.task.task_id),
		filename,
	].join("/");
}

function bindAbortSignal(
	objectStore: IngestionObjectStore,
	signal?: AbortSignal,
): IngestionObjectStore {
	return {
		derivedBucket: objectStore.derivedBucket,
		sourceBucket: objectStore.sourceBucket,
		async getObject(input) {
			signal?.throwIfAborted();
			return objectStore.getObject({ ...input, abortSignal: signal });
		},
		async headObject(input) {
			return objectStore.headObject({ ...input, abortSignal: signal });
		},
		async createOrVerifyObject(input) {
			signal?.throwIfAborted();
			return objectStore.createOrVerifyObject({ ...input, abortSignal: signal });
		},
	};
}
