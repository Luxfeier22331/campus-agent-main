import { createHash } from "node:crypto";

import canonicalStringify from "canonical-json";
import type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
} from "ingestion-contracts";
import { validateIngestionTaskEnvelope } from "ingestion-contracts";
import { type ZodIssue, z } from "zod";

export type Sha256Digest = `sha256:${string}`;

export interface ObjectStoreLocation {
	bucket: string;
	key: string;
}

export interface ArtifactWriteInput {
	bucket: string;
	key: string;
	body: Uint8Array;
	contentType: string;
	metadata?: Record<string, string>;
}

export interface ArtifactWriteResult {
	byteSize: number;
	contentSha256: string;
}

export interface StoredArtifactRef {
	bucket?: string;
	objectKey: string;
	contentSha256: string;
	byteSize: number;
	recordCount?: number;
	etag?: string | null;
	versionId?: string | null;
}

export interface StoredArtifactHead {
	bucket?: string;
	objectKey: string;
	contentSha256: string | null;
	byteSize: number | null;
	etag?: string | null;
	versionId?: string | null;
}

export interface ObjectStoreReader {
	getObject(input: ObjectStoreLocation): Promise<Uint8Array>;
}

export interface ObjectStoreWriter {
	putObject(input: ArtifactWriteInput): Promise<ArtifactWriteResult>;
}

export type ObjectStore = ObjectStoreReader & ObjectStoreWriter;

export const SourceObjectRefSchema = z.object({
	bucket: z.string().trim().min(1),
	key: z
		.string()
		.trim()
		.min(1)
		.refine((value) => !(value.startsWith("/") || value.split("/").includes("..")), {
			message: "must be a relative object key without .. segments",
		}),
	content_sha256: z
		.string()
		.trim()
		.regex(/^(?:sha256:)?[0-9a-f]{64}$/u)
		.optional()
		.nullable(),
	byte_size: z.number().int().nonnegative().optional().nullable(),
});

export const SourceObjectRefPayloadSchema = SourceObjectRefSchema.transform(
	(value): SourceObjectRef => ({
		bucket: value.bucket,
		byteSize: value.byte_size ?? null,
		contentSha256: value.content_sha256 ? normalizeSha256Hex(value.content_sha256) : null,
		key: value.key,
	}),
);

export const RequiredTextSchema = z
	.string()
	.transform((value) => value.trim())
	.pipe(z.string().min(1));

export const RequiredScalarTextSchema = z
	.union([z.string(), z.number()])
	.transform((value) => String(value).trim())
	.pipe(z.string().min(1));

export const OptionalTextSchema = z
	.string()
	.transform((value) => value.trim())
	.pipe(z.string().min(1))
	.nullable()
	.catch(null);

export const RequiredIntegerSchema = z.number().int();
export const RequiredNonNegativeIntegerSchema = z.number().int().nonnegative();
export const OptionalIntegerSchema = z.number().int().nullable().catch(null);
export const JsonRecordSchema = z.record(z.string(), z.unknown());

export interface SourceObjectRef {
	bucket: string;
	byteSize: number | null;
	contentSha256: string | null;
	key: string;
}

export function sha256Hex(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function sha256Digest(value: Uint8Array | string): Sha256Digest {
	return `sha256:${sha256Hex(value)}`;
}

export function assertSha256Digest(input: {
	actualSha256: string;
	digest?: string | null;
	label: string;
}): void {
	if (!input.digest?.trim()) {
		throw new Error(`${input.label} digest is required`);
	}
	if (!input.digest.startsWith("sha256:")) {
		throw new Error(`${input.label} digest must use sha256`);
	}
	if (input.digest.slice("sha256:".length) !== normalizeSha256Hex(input.actualSha256)) {
		throw new Error(`${input.label} digest mismatch`);
	}
}

export function assertOptionalSha256Digest(input: {
	actualSha256: string;
	digest?: string | null;
	label: string;
}): void {
	if (!input.digest?.trim()) {
		return;
	}
	assertSha256Digest(input);
}

export function assertObjectStoreSha256Digest(input: {
	actualSha256: string;
	label: string;
	ref: IngestionArtifactRef;
}): void {
	assertSha256Digest({
		actualSha256: input.actualSha256,
		digest: input.ref.digest,
		label: input.label,
	});
}

export function buildS3Uri(input: ObjectStoreLocation): string {
	const bucket = input.bucket.trim();
	const key = input.key.trim();
	if (!bucket) {
		throw new Error("object-store bucket is required");
	}
	if (!key) {
		throw new Error("object-store key is required");
	}
	return `s3://${bucket}/${key}`;
}

export function parseS3Uri(refOrUri: string | Pick<IngestionArtifactRef, "kind" | "uri">): {
	bucket: string;
	key: string;
} {
	const uri = typeof refOrUri === "string" ? refOrUri : refOrUri.uri;
	if (typeof refOrUri !== "string" && refOrUri.kind !== "object_store") {
		throw new Error(`input_ref must be object_store, got ${refOrUri.kind}`);
	}
	if (!uri.startsWith("s3://")) {
		const prefix = typeof refOrUri === "string" ? "object-store uri" : "input_ref object_store uri";
		throw new Error(`${prefix} must use s3://, got ${uri}`);
	}
	const rest = uri.slice("s3://".length);
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash === rest.length - 1) {
		throw new Error(`invalid s3 uri: ${uri}`);
	}
	return {
		bucket: rest.slice(0, slash),
		key: rest.slice(slash + 1),
	};
}

export function buildObjectStoreArtifactRef(input: {
	bucket: string;
	contentSha256: string;
	key: string;
}): IngestionArtifactRef {
	return {
		kind: "object_store",
		uri: buildS3Uri(input),
		digest: toSha256Digest(input.contentSha256),
	};
}

export function canonicalJsonString(value: unknown): string {
	const canonical = canonicalStringify(value);
	if (typeof canonical !== "string") {
		throw new Error("canonical JSON value is not serializable");
	}
	return canonical;
}

export function encodeCanonicalJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(canonicalJsonString(value));
}

export function encodeJsonLines(records: readonly unknown[]): Uint8Array {
	return new TextEncoder().encode(
		`${records.map((record) => canonicalJsonString(record)).join("\n")}\n`,
	);
}

export function canonicalJsonSha256Hex(value: unknown): string {
	return sha256Hex(encodeCanonicalJson(value));
}

export function canonicalJsonSha256Digest(value: unknown): Sha256Digest {
	return `sha256:${canonicalJsonSha256Hex(value)}`;
}

export function parseJsonObjectBytes(value: Uint8Array, label: string): Record<string, unknown> {
	const parsed = parseJsonBytes(value, label);
	if (!isRecord(parsed)) {
		throw new Error(`${label} must be a JSON object`);
	}
	return parsed;
}

export function parseJsonObjectLinesBytes(
	value: Uint8Array | string,
	label: string,
): Record<string, unknown>[] {
	return decodeUtf8(value)
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line, index) => {
			const parsed = parseJsonText(line, `${label} line ${index + 1}`);
			if (!isRecord(parsed)) {
				throw new Error(`${label} line ${index + 1} must be a JSON object`);
			}
			return parsed;
		});
}

export function parseRecord(value: unknown, label: string): Record<string, unknown> {
	const parsed = JsonRecordSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`${label} must be an object`);
	}
	return parsed.data;
}

export function parseArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	return value;
}

export function parseRequiredText(value: unknown, label: string): string {
	const parsed = RequiredTextSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`${label} is required`);
	}
	return parsed.data;
}

export function parseRequiredScalarText(value: unknown, label: string): string {
	const parsed = RequiredScalarTextSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`${label} is required`);
	}
	return parsed.data;
}

export function parseOptionalText(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	return OptionalTextSchema.parse(value);
}

export function parseRequiredInteger(value: unknown, label: string): number {
	const parsed = RequiredIntegerSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`${label} must be an integer`);
	}
	return parsed.data;
}

export function parseOptionalInteger(value: unknown): number | null {
	return OptionalIntegerSchema.parse(value);
}

export function parseRequiredNonNegativeInteger(value: unknown, label: string): number {
	const parsed = RequiredNonNegativeIntegerSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`${label} must be a non-negative integer`);
	}
	return parsed.data;
}

export function parseJsonArrayBytes(value: Uint8Array, label: string): unknown[] {
	const parsed = parseJsonBytes(value, label);
	if (!Array.isArray(parsed)) {
		throw new Error(`${label} must be a JSON array`);
	}
	return parsed;
}

export function parseSourceObjectRef(value: unknown, label: string): SourceObjectRef {
	const parsed = SourceObjectRefPayloadSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`${label} is invalid: ${formatZodIssues(parsed.error.issues, label).join("; ")}`,
		);
	}
	return parsed.data;
}

export class IngestionTaskEnvelopeParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IngestionTaskEnvelopeParseError";
	}
}

export function parseIngestionTaskEnvelope(value: unknown): IngestionTaskEnvelope {
	const validation = validateIngestionTaskEnvelope(value);
	if (!validation.ok) {
		throw new IngestionTaskEnvelopeParseError(
			`invalid ingestion task: ${validation.errors.join("; ")}`,
		);
	}
	return value as IngestionTaskEnvelope;
}

export function formatZodIssues(issues: readonly ZodIssue[], rootLabel = "payload"): string[] {
	return issues.map((issue) => {
		const path = zodPath(rootLabel, issue.path);
		return `${path}: ${issue.message}`;
	});
}

export class IngestionTaskRegistryCatalog {
	readonly #registries = new Map<string, IngestionTaskRegistry>();

	constructor(registries: readonly IngestionTaskRegistry[]) {
		for (const registry of registries) {
			const key = registryKey({
				source_family: registry.source_family,
				corpus: registry.corpus,
				collection: registry.collection,
			});
			if (this.#registries.has(key)) {
				throw new Error(`duplicate ingestion task registry: ${key}`);
			}
			assertUniqueRegistryTasks(key, registry);
			this.#registries.set(key, registry);
		}
	}

	requireTask(task: IngestionTaskEnvelope): IngestionTaskRegistryTask {
		const { registryTask } = this.#requireRegistryTask(task);
		if (task.task_kind !== registryTask.task_kind) {
			throw new RegistryAdmissionError(
				`task kind mismatch for ${task.registry_task_id}: expected ${registryTask.task_kind}, got ${task.task_kind}`,
			);
		}
		if (task.input_contract !== registryTask.input_contract) {
			throw new RegistryAdmissionError(
				`input contract mismatch for ${task.registry_task_id}: expected ${registryTask.input_contract}, got ${task.input_contract}`,
			);
		}
		if (task.output_contract !== registryTask.output_contract) {
			throw new RegistryAdmissionError(
				`output contract mismatch for ${task.registry_task_id}: expected ${registryTask.output_contract}, got ${task.output_contract}`,
			);
		}
		return registryTask;
	}

	requireRegistry(task: IngestionTaskEnvelope): IngestionTaskRegistry {
		return this.#requireRegistryTask(task).registry;
	}

	#requireRegistryTask(task: IngestionTaskEnvelope): {
		key: string;
		registry: IngestionTaskRegistry;
		registryTask: IngestionTaskRegistryTask;
	} {
		const key = registryKey(task);
		const registry = this.#registries.get(key);
		if (!registry) {
			throw new RegistryAdmissionError(
				`task collection is not declared by ingestion registry: ${key}`,
			);
		}
		const registryTask = registry.tasks.find(
			(candidate) => candidate.registry_task_id === task.registry_task_id,
		);
		if (!registryTask) {
			throw new RegistryAdmissionError(
				`task is not declared by ingestion registry: ${key}/${task.registry_task_id}`,
			);
		}
		return { key, registry, registryTask };
	}
}

export class RegistryAdmissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RegistryAdmissionError";
	}
}

export function createIngestionTaskRegistryCatalog(
	registries: readonly IngestionTaskRegistry[],
): IngestionTaskRegistryCatalog {
	return new IngestionTaskRegistryCatalog(registries);
}

function normalizeSha256Hex(value: string): string {
	return value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

function toSha256Digest(value: string): Sha256Digest {
	const digest = value.startsWith("sha256:") ? value : `sha256:${value}`;
	if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
		throw new Error("sha256 digest must use lowercase hex");
	}
	return digest as Sha256Digest;
}

function registryKey(input: { source_family: string; corpus: string; collection: string }): string {
	return [input.source_family, input.corpus, input.collection].join("/");
}

function assertUniqueRegistryTasks(key: string, registry: IngestionTaskRegistry): void {
	const seen = new Set<string>();
	for (const task of registry.tasks) {
		if (seen.has(task.registry_task_id)) {
			throw new Error(`duplicate ingestion task declaration: ${key}/${task.registry_task_id}`);
		}
		seen.add(task.registry_task_id);
	}
}

function parseJsonBytes(value: Uint8Array, label: string): unknown {
	return parseJsonText(new TextDecoder().decode(value), label);
}

function parseJsonText(value: string, label: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch (error) {
		throw new Error(`${label} must be valid JSON: ${errorMessage(error)}`);
	}
}

function decodeUtf8(value: Uint8Array | string): string {
	return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function zodPath(rootLabel: string, path: readonly PropertyKey[]): string {
	if (path.length === 0) {
		return rootLabel;
	}
	return path.reduce<string>((current, segment) => {
		if (typeof segment === "number") {
			return `${current}[${segment}]`;
		}
		return `${current}.${String(segment)}`;
	}, rootLabel);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
} from "ingestion-contracts";
