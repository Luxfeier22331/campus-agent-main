import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
	createOrVerifyObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult>;
}

export function createSourceCollectorObjectStoreFromEnv(
	env: Record<string, string | undefined> = process.env,
): SourceCollectorObjectStore {
	const endpoint = requiredEnv(env, "OBJECT_STORE_ENDPOINT");
	const accessKey = requiredEnv(env, "OBJECT_STORE_SOURCE_ACCESS_KEY");
	const secretKey = requiredEnv(env, "OBJECT_STORE_SOURCE_SECRET_KEY");
	const sourceBucket = env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-agent-source";
	const client = new S3Client({
		endpoint,
		region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
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
			const result = await client.send(
				new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
				{ abortSignal: input.abortSignal },
			);
			if (!result.Body) {
				throw new Error(`object body is missing: s3://${input.bucket}/${input.key}`);
			}
			return result.Body.transformToByteArray();
		},
		async createOrVerifyObject(input) {
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

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
