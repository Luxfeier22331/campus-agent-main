import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type {
	PublishedReaderObjectStoreConfig,
	PublishedReaderObjectStoreCredentials,
	PublishedReaderObjectStoreEnv,
	ReaderObjectStoreWriter,
} from "./published-reader-types.ts";

export function createS3ObjectStore(
	env: PublishedReaderObjectStoreEnv = process.env,
): ReaderObjectStoreWriter {
	const { accessKeyId, bucket, endpoint, region, secretAccessKey } =
		resolvePublishedReaderObjectStoreConfig(env);
	const client = new S3Client({
		credentials: { accessKeyId, secretAccessKey },
		endpoint,
		forcePathStyle: true,
		region,
	});
	return {
		async readOptionalBytesObject(input: { key: string }) {
			try {
				const response = await client.send(
					new GetObjectCommand({ Bucket: bucket, Key: input.key }),
				);
				if (!response.Body) {
					throw new Error(`empty object body: ${input.key}`);
				}
				return response.Body.transformToByteArray();
			} catch (error) {
				if (isMissingObjectError(error)) {
					return;
				}
				throw error;
			}
		},
		async writeBytesObject(input) {
			await client.send(
				new PutObjectCommand({
					Body: input.body,
					Bucket: bucket,
					ContentType: input.contentType,
					Key: input.key,
				}),
			);
		},
	};
}

export function resolvePublishedReaderObjectStoreConfig(
	env: PublishedReaderObjectStoreEnv,
): PublishedReaderObjectStoreConfig {
	const endpoint = readRequiredEnv(env, "OBJECT_STORE_ENDPOINT");
	const bucket = resolvePublishedReaderObjectStoreBucket();
	const region = "us-east-1";
	const { accessKeyId, credentialMode, secretAccessKey } =
		resolvePublishedReaderObjectStoreCredentials(env);
	return {
		accessKeyId,
		bucket,
		credentialMode,
		endpoint,
		region,
		secretAccessKey,
	};
}

export function resolvePublishedReaderObjectStoreBucket(): string {
	return "campus-agent-derived";
}

export function resolvePublishedReaderObjectStoreCredentials(
	env: PublishedReaderObjectStoreEnv,
): PublishedReaderObjectStoreCredentials {
	return {
		accessKeyId: readRequiredEnv(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
		credentialMode: "derived",
		secretAccessKey: readRequiredEnv(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
	};
}

export function isMissingObjectError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			(("name" in error && error.name === "NoSuchKey") ||
				("Code" in error && error.Code === "NoSuchKey")),
	);
}

function readRequiredEnv(
	env: PublishedReaderObjectStoreEnv,
	name: keyof PublishedReaderObjectStoreEnv,
): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required to read the campus docs source`);
	}
	return value;
}
