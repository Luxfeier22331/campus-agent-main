import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { APP_ROOT } from "./sync-real-docs/shared";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export type PublicDocsPublishEnvironment = "prod" | "staging";
export type PublicDocsManifestCheckVerdict = "blocked" | "changed" | "invalid" | "unchanged";
export type PublicDocsReleaseLedgerStatus =
	| "building"
	| "checking"
	| "deployed"
	| "deploying"
	| "failed"
	| "rolled_back"
	| "skipped"
	| "smoking"
	| "validating";

export interface PublicDocsManifestValidationResult {
	errors: string[];
	ok: boolean;
	warnings: string[];
}

export interface PublicDocsReleaseLedgerRecord {
	candidateManifestDigest: string;
	candidateReleaseId: string;
	cloudflareDeploymentId?: string;
	cloudflareVersionId?: string;
	completedAt?: string;
	environment: PublicDocsPublishEnvironment;
	failureReason?: string;
	id: string;
	lockId?: string;
	previousManifestDigest?: string;
	previousReleaseId?: string;
	attemptNumber?: number;
	retryOfRecordId?: string;
	rollbackCommand?: string;
	rollbackReason?: string;
	rollbackTargetRecordId?: string;
	rollbackTargetReleaseId?: string;
	rollbackTargetVersionId?: string;
	runnerId?: string;
	scheduleKey?: string;
	startedAt: string;
	status: PublicDocsReleaseLedgerStatus;
	surface: "public_docs";
	trigger?: "forced" | "hook" | "manual" | "scheduled";
	validation: PublicDocsManifestValidationResult;
}

export interface PublicDocsReleaseLedger {
	records: PublicDocsReleaseLedgerRecord[];
	version: 1;
}

export interface PublicDocsManifestCheckResult {
	candidateManifestDigest: string;
	candidateReleaseId: string;
	ledgerRecord: PublicDocsReleaseLedgerRecord;
	previousManifestDigest?: string;
	previousReleaseId?: string;
	summary: PublicDocsManifestCheckSummary;
	validation: PublicDocsManifestValidationResult;
	verdict: PublicDocsManifestCheckVerdict;
}

export interface PublicDocsManifestCheckSummary {
	gatedEntryCount: number;
	publicEntryCount: number;
	totalEntryCount: number;
}

interface PublishedReaderManifest {
	entries: PublishedReaderManifestEntry[];
	generatedAt?: string;
	surface?: string;
}

interface PublishedReaderManifestEntry {
	deliveryMode: string;
	docId?: string;
	sourceObjects: Record<string, string>;
	targetObjects: Record<string, string>;
}

interface ReaderAssetManifest {
	files: Record<
		string,
		{
			sha256: string;
			sizeBytes: number;
		}
	>;
}

const CORE_SOURCE_LABELS: Record<string, string> = {
	"asset-manifest": "manifest",
	meta: "meta",
	outline: "outline",
	reader: "reader",
};

export async function checkPublishedReaderManifest(input: {
	client: ObjectStoreClient;
	environment: PublicDocsPublishEnvironment;
	ledgerFilePath?: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	now?: string;
	runnerId?: string;
}): Promise<PublicDocsManifestCheckResult> {
	const startedAt = input.now ?? new Date().toISOString();
	const rawManifest = await readManifestText(input);
	const candidateManifestDigest = sha256Hex(rawManifest);
	const ledger = input.ledgerFilePath
		? readPublicDocsReleaseLedger(input.ledgerFilePath)
		: emptyLedger();
	const previous = findLastDeployedRecord(ledger, input.environment);

	let candidateReleaseId = candidateManifestDigest.slice(0, 16);
	let summary: PublicDocsManifestCheckSummary = {
		gatedEntryCount: 0,
		publicEntryCount: 0,
		totalEntryCount: 0,
	};
	let validation: PublicDocsManifestValidationResult = {
		errors: [],
		ok: true,
		warnings: [],
	};

	try {
		const manifest = parseManifest(rawManifest);
		candidateReleaseId = resolveCandidateReleaseId(manifest, candidateManifestDigest);
		const manifestValidation = await validateManifest({
			client: input.client,
			manifest,
		});
		summary = manifestValidation.summary;
		validation = manifestValidation.validation;
	} catch (error) {
		validation = {
			errors: [error instanceof Error ? error.message : String(error)],
			ok: false,
			warnings: [],
		};
	}

	const verdict = resolveVerdict({
		candidateManifestDigest,
		previousManifestDigest: previous?.candidateManifestDigest,
		validation,
	});
	const ledgerRecord = buildLedgerRecord({
		candidateManifestDigest,
		candidateReleaseId,
		environment: input.environment,
		previous,
		runnerId: input.runnerId,
		startedAt,
		validation,
		verdict,
	});

	return {
		candidateManifestDigest,
		candidateReleaseId,
		ledgerRecord,
		previousManifestDigest: previous?.candidateManifestDigest,
		previousReleaseId: previous?.candidateReleaseId,
		summary,
		validation,
		verdict,
	};
}

export function appendPublicDocsReleaseLedgerRecord(input: {
	ledgerFilePath: string;
	record: PublicDocsReleaseLedgerRecord;
}): PublicDocsReleaseLedger {
	validateLedgerRecord(input.record);
	const ledger = readPublicDocsReleaseLedger(input.ledgerFilePath);
	const nextLedger: PublicDocsReleaseLedger = {
		records: [...ledger.records, input.record],
		version: 1,
	};
	writePublicDocsReleaseLedger(input.ledgerFilePath, nextLedger);
	return nextLedger;
}

export function readPublicDocsReleaseLedger(ledgerFilePath: string): PublicDocsReleaseLedger {
	if (!existsSync(ledgerFilePath)) {
		return emptyLedger();
	}
	const parsed = JSON.parse(
		readFileSync(ledgerFilePath, "utf8"),
	) as Partial<PublicDocsReleaseLedger>;
	if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
		throw new Error("public docs release ledger must contain version=1 and records[]");
	}
	for (const record of parsed.records) {
		validateLedgerRecord(record);
	}
	return { records: parsed.records, version: 1 };
}

function writePublicDocsReleaseLedger(
	ledgerFilePath: string,
	ledger: PublicDocsReleaseLedger,
): void {
	mkdirSync(dirname(ledgerFilePath), { recursive: true });
	const tempFilePath = `${ledgerFilePath}.${process.pid}.tmp`;
	writeFileSync(tempFilePath, `${JSON.stringify(ledger, null, 2)}\n`);
	renameSync(tempFilePath, ledgerFilePath);
}

function validateLedgerRecord(record: PublicDocsReleaseLedgerRecord): void {
	if (record.surface !== "public_docs") {
		throw new Error("public docs release ledger record must use surface=public_docs");
	}
	if (record.status === "deployed" && !record.validation.ok) {
		throw new Error("deployed release ledger record requires successful validation");
	}
	if (
		record.status === "rolled_back" &&
		!(
			record.rollbackTargetRecordId &&
			record.rollbackTargetReleaseId &&
			record.rollbackTargetVersionId
		)
	) {
		throw new Error("rolled_back release ledger record requires rollback target metadata");
	}
}

async function readManifestText(input: {
	client: ObjectStoreClient;
	manifestFilePath?: string;
	manifestObjectKey?: string;
}): Promise<string> {
	if (input.manifestFilePath) {
		return readFileSync(input.manifestFilePath, "utf8");
	}
	const manifestObjectKey = input.manifestObjectKey?.trim();
	if (!manifestObjectKey) {
		throw new Error("manifestFilePath or manifestObjectKey is required");
	}
	return input.client.readTextObject({ key: manifestObjectKey });
}

function parseManifest(rawManifest: string): PublishedReaderManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawManifest);
	} catch (error) {
		throw new Error(
			`manifest JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("published reader manifest must be an object");
	}
	const manifest = parsed as Partial<PublishedReaderManifest>;
	if (manifest.surface !== "public_docs") {
		throw new Error("published reader manifest surface must be public_docs");
	}
	if (!Array.isArray(manifest.entries)) {
		throw new Error("published reader manifest must contain entries[]");
	}
	return {
		entries: manifest.entries.map(normalizeEntry),
		generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : undefined,
		surface: manifest.surface,
	};
}

function normalizeEntry(value: unknown): PublishedReaderManifestEntry {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("published reader manifest entry must be an object");
	}
	const entry = value as Partial<PublishedReaderManifestEntry>;
	if (!entry.deliveryMode?.trim()) {
		throw new Error("published reader manifest entry requires deliveryMode");
	}
	if (!isStringRecord(entry.sourceObjects)) {
		throw new Error("published reader manifest entry requires sourceObjects");
	}
	if (!isStringRecord(entry.targetObjects)) {
		throw new Error("published reader manifest entry requires targetObjects");
	}
	return {
		deliveryMode: entry.deliveryMode,
		docId: entry.docId,
		sourceObjects: entry.sourceObjects,
		targetObjects: entry.targetObjects,
	};
}

async function validateManifest(input: {
	client: ObjectStoreClient;
	manifest: PublishedReaderManifest;
}): Promise<{
	summary: PublicDocsManifestCheckSummary;
	validation: PublicDocsManifestValidationResult;
}> {
	const errors: string[] = [];
	const warnings: string[] = [];
	const seenTargetObjects = new Set<string>();
	let gatedEntryCount = 0;
	let publicEntryCount = 0;

	for (const [entryIndex, entry] of input.manifest.entries.entries()) {
		if (entry.deliveryMode === "public_static_asset") {
			publicEntryCount += 1;
		} else if (entry.deliveryMode === "gated_asset") {
			gatedEntryCount += 1;
		} else {
			errors.push(
				`entry ${entryLabel(entryIndex, entry)} has unsupported deliveryMode: ${entry.deliveryMode}`,
			);
			continue;
		}

		for (const [targetLabel, targetObject] of Object.entries(entry.targetObjects)) {
			validateTargetObject({
				deliveryMode: entry.deliveryMode,
				entry,
				entryIndex,
				errors,
				seenTargetObjects,
				targetLabel,
				targetObject,
			});
			const sourceObject = resolveSourceObjectKey(entry, targetLabel);
			if (!sourceObject) {
				errors.push(
					`entry ${entryLabel(entryIndex, entry)} is missing source object for target ${targetLabel}`,
				);
			}
		}

		await validateEntryAssetIntegrity({
			client: input.client,
			entry,
			entryIndex,
			errors,
		});
	}

	return {
		summary: {
			gatedEntryCount,
			publicEntryCount,
			totalEntryCount: input.manifest.entries.length,
		},
		validation: {
			errors,
			ok: errors.length === 0,
			warnings,
		},
	};
}

function validateTargetObject(input: {
	deliveryMode: string;
	entry: PublishedReaderManifestEntry;
	entryIndex: number;
	errors: string[];
	seenTargetObjects: Set<string>;
	targetLabel: string;
	targetObject: string;
}): void {
	const normalizedTargetObject = input.targetObject.trim().replaceAll("\\", "/");
	if (
		!normalizedTargetObject ||
		normalizedTargetObject.startsWith("/") ||
		normalizedTargetObject.split("/").includes("..")
	) {
		input.errors.push(
			`entry ${entryLabel(input.entryIndex, input.entry)} has unsafe target object: ${
				input.targetObject
			}`,
		);
		return;
	}
	if (input.seenTargetObjects.has(normalizedTargetObject)) {
		input.errors.push(`duplicate reader asset target: ${normalizedTargetObject}`);
	}
	input.seenTargetObjects.add(normalizedTargetObject);

	if (
		input.deliveryMode === "public_static_asset" &&
		!normalizedTargetObject.startsWith("_docs/")
	) {
		input.errors.push("public reader asset target must stay under _docs/");
	}
	if (input.deliveryMode === "gated_asset" && !normalizedTargetObject.startsWith("_gated-docs/")) {
		input.errors.push("gated reader asset target must stay under _gated-docs/");
	}
	if (
		(input.targetLabel === "asset-manifest" || input.targetLabel === "manifest") &&
		!normalizedTargetObject.endsWith("/asset-manifest.json")
	) {
		input.errors.push(
			`entry ${entryLabel(input.entryIndex, input.entry)} asset-manifest target must end with asset-manifest.json`,
		);
	}
}

async function validateEntryAssetIntegrity(input: {
	client: ObjectStoreClient;
	entry: PublishedReaderManifestEntry;
	entryIndex: number;
	errors: string[];
}): Promise<void> {
	const manifestObjectKey =
		input.entry.sourceObjects.manifest ?? input.entry.sourceObjects["asset-manifest"];
	if (!manifestObjectKey) {
		input.errors.push(
			`entry ${entryLabel(input.entryIndex, input.entry)} is missing asset manifest source object`,
		);
		return;
	}
	const manifestBytes = await readOptionalObjectBytes(input.client, manifestObjectKey);
	if (!manifestBytes) {
		input.errors.push(`missing reader asset source object: ${manifestObjectKey}`);
		return;
	}
	const assetManifest = parseAssetManifest({
		bytes: manifestBytes,
		entry: input.entry,
		entryIndex: input.entryIndex,
		errors: input.errors,
	});
	if (!assetManifest) {
		return;
	}

	for (const [targetLabel, targetObject] of Object.entries(input.entry.targetObjects)) {
		if (targetLabel === "asset-manifest" || targetLabel === "manifest") {
			continue;
		}
		const sourceObject = resolveSourceObjectKey(input.entry, targetLabel);
		if (!sourceObject) {
			continue;
		}
		const bytes = await readOptionalObjectBytes(input.client, sourceObject);
		if (!bytes) {
			input.errors.push(`missing reader asset source object: ${sourceObject}`);
			continue;
		}
		const filePath = resolveReaderAssetFilePath(targetObject);
		const expected = assetManifest.files[filePath];
		if (!expected) {
			input.errors.push(`asset-manifest.json is missing file entry: ${filePath}`);
			continue;
		}
		const actualSize = bytes.byteLength;
		const actualSha256 = sha256Hex(bytes);
		if (expected.sizeBytes !== actualSize || expected.sha256 !== actualSha256) {
			input.errors.push(`reader asset failed manifest integrity check: ${filePath}`);
		}
	}
}

async function readOptionalObjectBytes(
	client: ObjectStoreClient,
	key: string,
): Promise<Uint8Array | undefined> {
	return client.readOptionalBytesObject({ key });
}

function parseAssetManifest(input: {
	bytes: Uint8Array;
	entry: PublishedReaderManifestEntry;
	entryIndex: number;
	errors: string[];
}): ReaderAssetManifest | undefined {
	let parsed: Partial<ReaderAssetManifest>;
	try {
		parsed = JSON.parse(new TextDecoder().decode(input.bytes)) as Partial<ReaderAssetManifest>;
	} catch (error) {
		input.errors.push(
			`entry ${entryLabel(input.entryIndex, input.entry)} asset-manifest.json is invalid JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return;
	}
	if (!parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)) {
		input.errors.push("asset-manifest.json must contain files");
		return;
	}
	return {
		files: parsed.files,
	};
}

function resolveReaderAssetFilePath(targetObject: string): string {
	const parts = targetObject.trim().replaceAll("\\", "/").split("/");
	if (parts.length < 6) {
		return parts.at(-1) ?? "";
	}
	return parts.slice(5).join("/");
}

function resolveSourceObjectKey(
	entry: PublishedReaderManifestEntry,
	targetLabel: string,
): string | undefined {
	const sourceLabel = CORE_SOURCE_LABELS[targetLabel] ?? `supplement.${targetLabel}`;
	return entry.sourceObjects[sourceLabel] ?? entry.sourceObjects[targetLabel];
}

function resolveVerdict(input: {
	candidateManifestDigest: string;
	previousManifestDigest?: string;
	validation: PublicDocsManifestValidationResult;
}): PublicDocsManifestCheckVerdict {
	if (!input.validation.ok) {
		return input.validation.errors.some(
			(error) =>
				error.includes("gated reader asset target must stay under _gated-docs/") ||
				error.includes("duplicate reader asset target") ||
				error.includes("failed manifest integrity check") ||
				error.includes("missing reader asset source object"),
		)
			? "blocked"
			: "invalid";
	}
	return input.previousManifestDigest === input.candidateManifestDigest ? "unchanged" : "changed";
}

function buildLedgerRecord(input: {
	candidateManifestDigest: string;
	candidateReleaseId: string;
	environment: PublicDocsPublishEnvironment;
	previous?: PublicDocsReleaseLedgerRecord;
	runnerId?: string;
	startedAt: string;
	validation: PublicDocsManifestValidationResult;
	verdict: PublicDocsManifestCheckVerdict;
}): PublicDocsReleaseLedgerRecord {
	const status = resolveLedgerStatus(input.verdict);
	return {
		candidateManifestDigest: input.candidateManifestDigest,
		candidateReleaseId: input.candidateReleaseId,
		completedAt: status === "validating" ? undefined : input.startedAt,
		environment: input.environment,
		failureReason: status === "failed" ? input.validation.errors.join("; ") : undefined,
		id: buildLedgerRecordId({
			candidateManifestDigest: input.candidateManifestDigest,
			environment: input.environment,
			startedAt: input.startedAt,
		}),
		previousManifestDigest: input.previous?.candidateManifestDigest,
		previousReleaseId: input.previous?.candidateReleaseId,
		runnerId: input.runnerId,
		startedAt: input.startedAt,
		status,
		surface: "public_docs",
		validation: input.validation,
	};
}

function resolveLedgerStatus(
	verdict: PublicDocsManifestCheckVerdict,
): PublicDocsReleaseLedgerStatus {
	if (verdict === "unchanged") {
		return "skipped";
	}
	if (verdict === "changed") {
		return "validating";
	}
	return "failed";
}

function buildLedgerRecordId(input: {
	candidateManifestDigest: string;
	environment: PublicDocsPublishEnvironment;
	startedAt: string;
}): string {
	return [
		"public_docs",
		input.environment,
		input.startedAt.replace(/[^0-9A-Za-z]/g, ""),
		input.candidateManifestDigest.slice(0, 12),
	].join(":");
}

function findLastDeployedRecord(
	ledger: PublicDocsReleaseLedger,
	environment: PublicDocsPublishEnvironment,
): PublicDocsReleaseLedgerRecord | undefined {
	return [...ledger.records]
		.reverse()
		.find(
			(record) =>
				record.surface === "public_docs" &&
				record.environment === environment &&
				record.status === "deployed",
		);
}

function resolveCandidateReleaseId(
	manifest: PublishedReaderManifest,
	candidateManifestDigest: string,
): string {
	return manifest.generatedAt?.trim() || candidateManifestDigest.slice(0, 16);
}

function emptyLedger(): PublicDocsReleaseLedger {
	return { records: [], version: 1 };
}

function entryLabel(index: number, entry: PublishedReaderManifestEntry): string {
	return entry.docId ? `${index} (${entry.docId})` : String(index);
}

function sha256Hex(content: string | Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((item) => typeof item === "string" && item.trim().length > 0)
	);
}

export function parsePublishedReaderManifestCheckArgs(argv: string[]): {
	environment: PublicDocsPublishEnvironment;
	ledgerFilePath?: string;
	manifestFilePath?: string;
	manifestObjectKey?: string;
	writeLedger: boolean;
} {
	const args = [...argv];
	let environment: PublicDocsPublishEnvironment =
		process.env.CLOUDFLARE_ENV === "staging" ? "staging" : "prod";
	let ledgerFilePath: string | undefined;
	let manifestFilePath: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_PATH;
	let manifestObjectKey: string | undefined = process.env.PUBLIC_DOCS_SYNC_MANIFEST_KEY;
	let writeLedger = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			continue;
		}
		if (arg === "--env") {
			environment = parseEnvironment(requireArgValue(args, index, arg));
			index += 1;
		} else if (arg === "--ledger") {
			ledgerFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-path") {
			manifestFilePath = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--manifest-key") {
			manifestObjectKey = requireArgValue(args, index, arg);
			index += 1;
		} else if (arg === "--write-ledger") {
			writeLedger = true;
		} else if (arg === "--dry-run") {
			writeLedger = false;
		} else {
			throw new Error(`unsupported argument: ${arg}`);
		}
	}

	return {
		environment,
		ledgerFilePath,
		manifestFilePath,
		manifestObjectKey,
		writeLedger,
	};
}

function requireArgValue(args: string[], index: number, name: string): string {
	const value = args[index + 1]?.trim();
	if (!value) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

function parseEnvironment(value: string): PublicDocsPublishEnvironment {
	if (value === "prod" || value === "staging") {
		return value;
	}
	throw new Error("--env must be prod or staging");
}

async function main(): Promise<void> {
	const args = parsePublishedReaderManifestCheckArgs(process.argv.slice(2));
	const ledgerFilePath =
		args.ledgerFilePath ??
		resolve(APP_ROOT, "../../.planning/runtime/public-docs-publish/ledger.json");
	const result = await checkPublishedReaderManifest({
		client: createS3ObjectStore(),
		environment: args.environment,
		ledgerFilePath,
		manifestFilePath: args.manifestFilePath,
		manifestObjectKey: args.manifestObjectKey,
		runnerId: process.env.PUBLIC_DOCS_PUBLISH_RUNNER_ID,
	});
	if (args.writeLedger) {
		appendPublicDocsReleaseLedgerRecord({
			ledgerFilePath,
			record: result.ledgerRecord,
		});
	}
	console.log(JSON.stringify(result, null, 2));
	if (result.verdict === "invalid" || result.verdict === "blocked") {
		process.exitCode = 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
