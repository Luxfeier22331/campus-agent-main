import type { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
	ArtifactWriteInput,
	ArtifactWriteResult,
	ObjectStore,
	ObjectStoreLocation,
} from "ingest-core";
import { sha256Hex } from "ingest-core";
import { createOrVerifyS3Object } from "./s3-create-or-verify.ts";

export interface SourceCollectorObjectStore extends ObjectStore {
	readonly sourceBucket: string;
	close?(): Promise<void> | void;
	getObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<Uint8Array>;
	getObjectIfExists(
		input: ObjectStoreLocation & { abortSignal?: AbortSignal },
	): Promise<Uint8Array | null>;
	putObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult>;
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

export function createSourceCollectorObjectStoreFromEnv(
	env: Record<string, string | undefined> = process.env,
): SourceCollectorObjectStore {
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
				{ abortSignal: input.abortSignal },
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
					{ abortSignal: input.abortSignal },
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
		async createOrVerifyObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			return createOrVerifyS3Object({
				abortSignal: input.abortSignal,
				body: input.body,
				bucket: input.bucket,
				client,
				contentType: input.contentType,
				key: input.key,
				metadata: input.metadata,
			});
		},
		async putObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			const contentSha256 = sha256Hex(input.body);
			await client.send(
				new PutObjectCommand({
					Body: input.body,
					Bucket: input.bucket,
					ContentLength: input.body.byteLength,
					ContentType: input.contentType,
					Key: input.key,
					Metadata: { ...input.metadata, "content-sha256": contentSha256 },
				}),
				{ abortSignal: input.abortSignal },
			);
			return { byteSize: input.body.byteLength, contentSha256 };
		},
		async createOrVerifyStream(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			return createOrVerifyS3Object({
				abortSignal: input.abortSignal,
				body: input.body,
				byteSize: input.byteSize,
				bucket: input.bucket,
				client,
				contentSha256: input.contentSha256,
				contentType: input.contentType,
				key: input.key,
				metadata: input.metadata,
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
		throw new Error(`source collector cannot access non-source bucket: ${bucket}`);
	}
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
