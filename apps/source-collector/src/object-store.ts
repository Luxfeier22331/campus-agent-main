import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
	ArtifactWriteInput,
	ArtifactWriteResult,
	ObjectStore,
	ObjectStoreLocation,
} from "ingest-core";
import { createOrVerifyS3Object } from "./s3-create-or-verify.ts";

export interface SourceCollectorObjectStore extends ObjectStore {
	readonly sourceBucket: string;
	close?(): Promise<void> | void;
	getObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<Uint8Array>;
	headObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<{
		byteSize: number | null;
		contentSha256: string | null;
		etag: string | null;
		versionId: string | null;
	}>;
	createOrVerifyObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult & { etag: string | null; versionId: string | null }>;
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
		maxAttempts: 4,
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
		async headObject(input) {
			assertSourceBucket(input.bucket, sourceBucket);
			const result = await client.send(
				new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
				{ abortSignal: input.abortSignal },
			);
			const metadata = result.Metadata ?? {};
			return {
				byteSize: result.ContentLength ?? null,
				contentSha256: metadata["content-sha256"] ?? metadata.content_sha256 ?? null,
				etag: result.ETag ?? null,
				versionId: result.VersionId ?? null,
			};
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
	};
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
