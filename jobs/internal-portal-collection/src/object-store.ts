import type { Readable } from "node:stream";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectVersionsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { createOrVerifyS3Object, sha256Hex } from "./s3-create-or-verify.ts";

interface ObjectStoreLocation {
	bucket: string;
	key: string;
}

interface ArtifactWriteInput extends ObjectStoreLocation {
	body: Uint8Array;
	contentType: string;
	metadata?: Record<string, string>;
}

interface ArtifactWriteResult {
	byteSize: number;
	contentSha256: string;
	versionId?: string | null;
}

export interface InternalPortalCollectionObjectStore {
	readonly sourceBucket: string;
	close?(): Promise<void> | void;
	getObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<Uint8Array>;
	getObjectIfExists(
		input: ObjectStoreLocation & { abortSignal?: AbortSignal },
	): Promise<Uint8Array | null>;
	listObjectKeys?(input: { bucket: string; prefix: string }): Promise<string[]>;
	putObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult>;
	pruneObjectVersions(input: {
		abortSignal?: AbortSignal;
		bucket: string;
		key: string;
		keepVersionId: string;
	}): Promise<void>;
	createOrVerifyObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult>;
	createOrVerifyStream(input: {
		abortSignal?: AbortSignal;
		body: Readable;
		bucket: string;
		byteSize: number;
		contentSha256: string;
		contentType: string;
		key: string;
		metadata?: Record<string, string>;
	}): Promise<ArtifactWriteResult>;
}

export function createInternalPortalCollectionObjectStoreFromEnv(
	env: Record<string, string | undefined> = process.env,
): InternalPortalCollectionObjectStore {
	const endpoint = requiredEnv(env, "OBJECT_STORE_ENDPOINT");
	const accessKey = requiredEnv(env, "OBJECT_STORE_SOURCE_ACCESS_KEY");
	const secretKey = requiredEnv(env, "OBJECT_STORE_SOURCE_SECRET_KEY");
	const sourceBucket = "campus-agent-source";
	const client = new S3Client({
		endpoint,
		region: "us-east-1",
		credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
		forcePathStyle: true,
		maxAttempts: 1,
	});
	return {
		sourceBucket,
		close() {
			client.destroy();
		},
		async getObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			const result = await client.send(
				new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
				input.abortSignal ? { abortSignal: input.abortSignal } : {},
			);
			if (!result.Body) {
				throw new Error(`object body is missing: s3://${input.bucket}/${input.key}`);
			}
			return result.Body.transformToByteArray();
		},
		async getObjectIfExists(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			try {
				const result = await client.send(
					new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
					input.abortSignal ? { abortSignal: input.abortSignal } : {},
				);
				if (!result.Body) {
					throw new Error(`object body is missing: s3://${input.bucket}/${input.key}`);
				}
				return result.Body.transformToByteArray();
			} catch (error) {
				if (isNotFound(error)) {
					return null;
				}
				throw error;
			}
		},
		async listObjectKeys(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			const keys: string[] = [];
			let continuationToken: string | undefined;
			do {
				const result = await client.send(
					new ListObjectsV2Command({
						Bucket: input.bucket,
						ContinuationToken: continuationToken,
						Prefix: input.prefix,
					}),
				);
				keys.push(...(result.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
				if (result.IsTruncated && !result.NextContinuationToken) {
					throw new Error("object listing is truncated without a continuation token");
				}
				continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
			} while (continuationToken);
			return keys;
		},
		async createOrVerifyObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			return createOrVerifyS3Object({
				...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
				body: input.body,
				bucket: input.bucket,
				client,
				contentType: input.contentType,
				key: input.key,
				...(input.metadata ? { metadata: input.metadata } : {}),
			});
		},
		async putObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			const contentSha256 = sha256Hex(input.body);
			const result = await client.send(
				new PutObjectCommand({
					Body: input.body,
					Bucket: input.bucket,
					ContentLength: input.body.byteLength,
					ContentType: input.contentType,
					Key: input.key,
					Metadata: { ...input.metadata, "content-sha256": contentSha256 },
				}),
				input.abortSignal ? { abortSignal: input.abortSignal } : {},
			);
			return {
				byteSize: input.body.byteLength,
				contentSha256,
				etag: result.ETag ?? null,
				versionId: result.VersionId ?? null,
			};
		},
		async pruneObjectVersions(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			const keepVersionId = input.keepVersionId.trim();
			if (!keepVersionId || keepVersionId === "null") {
				throw new Error("versioned object cleanup requires a concrete keep version id");
			}
			let keyMarker: string | undefined;
			let versionIdMarker: string | undefined;
			const obsoleteVersionIds: string[] = [];
			do {
				const page = await client.send(
					new ListObjectVersionsCommand({
						Bucket: input.bucket,
						KeyMarker: keyMarker,
						Prefix: input.key,
						VersionIdMarker: versionIdMarker,
					}),
					input.abortSignal ? { abortSignal: input.abortSignal } : {},
				);
				for (const entry of [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])]) {
					if (entry.Key !== input.key || !entry.VersionId || entry.VersionId === keepVersionId) {
						continue;
					}
					obsoleteVersionIds.push(entry.VersionId);
				}
				keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
				versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
			} while (keyMarker || versionIdMarker);
			// Keep pagination markers valid until the complete listing has been read.
			for (const versionId of obsoleteVersionIds) {
				await client.send(
					new DeleteObjectCommand({
						Bucket: input.bucket,
						Key: input.key,
						VersionId: versionId,
					}),
					input.abortSignal ? { abortSignal: input.abortSignal } : {},
				);
			}
		},
		async createOrVerifyStream(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			return createOrVerifyS3Object({
				...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
				body: input.body,
				byteSize: input.byteSize,
				bucket: input.bucket,
				client,
				contentSha256: input.contentSha256,
				contentType: input.contentType,
				key: input.key,
				...(input.metadata ? { metadata: input.metadata } : {}),
			});
		},
	};
}

function isNotFound(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const candidate = error as {
		$metadata?: { httpStatusCode?: number };
		Code?: string;
		code?: string;
		name?: string;
	};
	return (
		candidate.$metadata?.httpStatusCode === 404 ||
		candidate.name === "NotFound" ||
		candidate.name === "NoSuchKey" ||
		candidate.Code === "NoSuchKey" ||
		candidate.code === "NoSuchKey"
	);
}

function assertSourceBucket(bucket: string, sourceBucket: string): void {
	if (bucket !== sourceBucket) {
		throw new Error(`internal portal collection cannot access non-source bucket: ${bucket}`);
	}
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
