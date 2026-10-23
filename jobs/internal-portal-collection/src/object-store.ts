import type { Readable } from "node:stream";
import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createS3Object } from "./s3-create-object.ts";
import { createSourceObjectStoreConnection } from "./source-object-store.ts";

interface ObjectStoreLocation {
	bucket: string;
	key: string;
}

interface ObjectWriteInput extends ObjectStoreLocation {
	abortSignal?: AbortSignal;
	body: Uint8Array;
	contentType: string;
}

export interface InternalPortalCollectionObjectStore {
	readonly sourceBucket: string;
	close?(): Promise<void> | void;
	getObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<Uint8Array>;
	getObjectIfExists(
		input: ObjectStoreLocation & { abortSignal?: AbortSignal },
	): Promise<Uint8Array | null>;
	hasObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<boolean>;
	listObjectKeys?(input: { bucket: string; prefix: string }): Promise<string[]>;
	/** Overwrite a mutable object such as `_state.json` or `meta.json`. */
	putObject(input: ObjectWriteInput): Promise<void>;
	/** Create an immutable object; see `createS3Object` for when an existing key is accepted. */
	createObject(
		input: Omit<ObjectWriteInput, "body"> & {
			body: Uint8Array | Readable;
			byteSize?: number;
			identity?: { byteSize: number; contentSha256: string };
		},
	): Promise<"created" | "existing">;
}

export function createInternalPortalCollectionObjectStoreFromEnv(
	env: Record<string, string | undefined> = process.env,
): InternalPortalCollectionObjectStore {
	const { bucket: sourceBucket, client } = createSourceObjectStoreConnection(env);
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
		async hasObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			try {
				await client.send(
					new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
					input.abortSignal ? { abortSignal: input.abortSignal } : {},
				);
				return true;
			} catch (error) {
				if (isNotFound(error)) return false;
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
		async putObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			await client.send(
				new PutObjectCommand({
					Body: input.body,
					Bucket: input.bucket,
					ContentLength: input.body.byteLength,
					ContentType: input.contentType,
					Key: input.key,
				}),
				input.abortSignal ? { abortSignal: input.abortSignal } : {},
			);
		},
		async createObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			return await createS3Object({ ...input, client });
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
