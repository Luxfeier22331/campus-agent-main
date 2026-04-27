import { readFileSync } from "node:fs";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createS3ObjectStore, type ObjectStoreClient } from "./sync-real-docs/storage";

export interface GatedReaderAssetsSyncResult {
	gatedDocumentCount: number;
	skippedDuplicateObjectCount: number;
	syncedObjectCount: number;
}

export interface WritableObjectStoreClient {
	writeBytesObject(input: {
		bucket?: string;
		bytes: Uint8Array;
		contentType: string;
		key: string;
	}): Promise<void>;
}

interface DocsReadModelManifest {
	documentVersions: Array<{
		deliveryMode: string;
		versionId: string;
	}>;
	readerAssets: Array<{
		sourceObjects: Record<string, string>;
		versionId: string;
	}>;
}

const DEFAULT_TARGET_BUCKET = "campus-agent-reader-assets-staging";

export async function syncGatedReaderAssetsToBucket(input: {
	dryRun?: boolean;
	manifestFilePath: string;
	sourceClient: ObjectStoreClient;
	targetBucket?: string;
	targetClient: WritableObjectStoreClient;
}): Promise<GatedReaderAssetsSyncResult> {
	const manifest = loadReadModelManifest(input.manifestFilePath);
	const gatedVersionIds = new Set(
		manifest.documentVersions
			.filter((version) => version.deliveryMode === "gated_asset")
			.map((version) => version.versionId),
	);
	const gatedReaderAssets = manifest.readerAssets.filter((asset) =>
		gatedVersionIds.has(asset.versionId),
	);
	const seenSourceObjects = new Set<string>();
	let syncedObjectCount = 0;
	let skippedDuplicateObjectCount = 0;

	for (const asset of gatedReaderAssets) {
		for (const sourceObject of Object.values(asset.sourceObjects)) {
			const key = normalizeObjectKey(sourceObject);
			if (seenSourceObjects.has(key)) {
				skippedDuplicateObjectCount += 1;
				continue;
			}
			seenSourceObjects.add(key);

			if (input.dryRun) {
				syncedObjectCount += 1;
				continue;
			}

			const bytes = await input.sourceClient.readOptionalBytesObject({ key });
			if (!bytes) {
				throw new Error(`missing gated reader asset source object: ${key}`);
			}
			await input.targetClient.writeBytesObject({
				bucket: input.targetBucket,
				bytes,
				contentType: contentTypeForObjectKey(key),
				key,
			});
			syncedObjectCount += 1;
		}
	}

	return {
		gatedDocumentCount: gatedReaderAssets.length,
		skippedDuplicateObjectCount,
		syncedObjectCount,
	};
}

function loadReadModelManifest(manifestFilePath: string): DocsReadModelManifest {
	const parsed = JSON.parse(
		readFileSync(manifestFilePath, "utf8"),
	) as Partial<DocsReadModelManifest>;
	if (!Array.isArray(parsed.documentVersions)) {
		throw new Error("docs read model manifest must contain documentVersions[]");
	}
	if (!Array.isArray(parsed.readerAssets)) {
		throw new Error("docs read model manifest must contain readerAssets[]");
	}
	return {
		documentVersions: parsed.documentVersions.map((version) => ({
			deliveryMode: requireNonEmptyString(version.deliveryMode, "documentVersions.deliveryMode"),
			versionId: requireNonEmptyString(version.versionId, "documentVersions.versionId"),
		})),
		readerAssets: parsed.readerAssets.map((asset) => ({
			sourceObjects: normalizeStringRecord(asset.sourceObjects, "readerAssets.sourceObjects"),
			versionId: requireNonEmptyString(asset.versionId, "readerAssets.versionId"),
		})),
	};
}

function normalizeObjectKey(value: string): string {
	const normalized = value.trim().replaceAll("\\", "/");
	if (
		!normalized ||
		normalized.startsWith("/") ||
		normalized.split("/").some((part) => part === "..")
	) {
		throw new Error(`unsafe gated reader asset source object key: ${value}`);
	}
	return normalized;
}

function normalizeStringRecord(value: unknown, field: string): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		result[key] = requireNonEmptyString(item, `${field}.${key}`);
	}
	return result;
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function contentTypeForObjectKey(key: string): string {
	if (key.endsWith(".json")) {
		return "application/json; charset=utf-8";
	}
	if (key.endsWith(".png")) {
		return "image/png";
	}
	if (key.endsWith(".jpg") || key.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	if (key.endsWith(".webp")) {
		return "image/webp";
	}
	return "application/octet-stream";
}

function createR2TargetClient(): WritableObjectStoreClient {
	const endpoint = requiredEnv("DOCS_READER_ASSETS_R2_ENDPOINT");
	const accessKeyId = requiredEnv("DOCS_READER_ASSETS_R2_ACCESS_KEY");
	const secretAccessKey = requiredEnv("DOCS_READER_ASSETS_R2_SECRET_KEY");
	const region = process.env.DOCS_READER_ASSETS_R2_REGION?.trim() || "auto";
	const client = new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint,
		forcePathStyle: true,
		region,
	});
	return {
		async writeBytesObject(input) {
			await client.send(
				new PutObjectCommand({
					Body: input.bytes,
					Bucket: input.bucket ?? DEFAULT_TARGET_BUCKET,
					ContentType: input.contentType,
					Key: input.key,
				}),
			);
		},
	};
}

function requiredEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for gated reader asset sync`);
	}
	return value;
}

async function main(): Promise<void> {
	const manifestFilePath = process.env.DOCS_READ_MODEL_MANIFEST_PATH?.trim();
	if (!manifestFilePath) {
		throw new Error("DOCS_READ_MODEL_MANIFEST_PATH is required for gated reader asset sync");
	}
	const result = await syncGatedReaderAssetsToBucket({
		dryRun: process.argv.includes("--dry-run"),
		manifestFilePath,
		sourceClient: createS3ObjectStore(),
		targetBucket: process.env.DOCS_READER_ASSETS_R2_BUCKET?.trim() || DEFAULT_TARGET_BUCKET,
		targetClient: createR2TargetClient(),
	});
	console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
