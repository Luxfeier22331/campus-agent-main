import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type {
	PublishedReaderObjectStoreConfig,
	PublishedReaderObjectStoreCredentials,
	PublishedReaderObjectStoreEnv,
	ReaderObjectStoreClient,
	ReaderObjectStoreWriter,
} from "./published-reader-types.ts";

export function createS3ReaderObjectStore(
	env: PublishedReaderObjectStoreEnv = process.env,
): ReaderObjectStoreClient {
	const { accessKeyId, endpoint, region, secretAccessKey } =
		resolvePublishedReaderObjectStoreConfig(env);
	const client = createS3Client({ accessKeyId, endpoint, region, secretAccessKey });
	return {
		readOptionalBytesObject: (input) => readOptionalBytesObject(client, input.key),
	};
}

export function createS3ObjectStore(
	env: PublishedReaderObjectStoreEnv = process.env,
): ReaderObjectStoreWriter {
	const { accessKeyId, bucket, endpoint, region, secretAccessKey } =
		resolvePublishedReaderObjectStoreWriterConfig(env);
	const client = createS3Client({ accessKeyId, endpoint, region, secretAccessKey });
	return {
		readOptionalBytesObject: (input) => readOptionalBytesObject(client, input.key),
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
		accessKeyId: readRequiredEnv(env, "OBJECT_STORE_DERIVED_READ_ACCESS_KEY"),
		credentialMode: "derived",
		secretAccessKey: readRequiredEnv(env, "OBJECT_STORE_DERIVED_READ_SECRET_KEY"),
	};
}

export function resolvePublishedReaderObjectStoreWriterConfig(
	env: PublishedReaderObjectStoreEnv,
): PublishedReaderObjectStoreConfig {
	const endpoint = readRequiredEnv(env, "OBJECT_STORE_ENDPOINT");
	return {
		...resolvePublishedReaderObjectStoreWriterCredentials(env),
		bucket: resolvePublishedReaderObjectStoreBucket(),
		endpoint,
		region: "us-east-1",
	};
}

export function resolvePublishedReaderObjectStoreWriterCredentials(
	env: PublishedReaderObjectStoreEnv,
): PublishedReaderObjectStoreCredentials {
	return {
		accessKeyId: readRequiredEnv(env, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
		credentialMode: "derived",
		secretAccessKey: readRequiredEnv(env, "OBJECT_STORE_DERIVED_SECRET_KEY"),
	};
}

function createS3Client(input: {
	accessKeyId: string;
	endpoint: string;
	region: string;
	secretAccessKey: string;
}): S3Client {
	return new S3Client({
		credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
		endpoint: input.endpoint,
		forcePathStyle: true,
		region: input.region,
	});
}

async function readOptionalBytesObject(
	client: S3Client,
	key: string,
): Promise<Uint8Array | undefined> {
	try {
		const response = await client.send(
			new GetObjectCommand({ Bucket: resolvePublishedReaderObjectStoreBucket(), Key: key }),
		);
		if (!response.Body) {
			throw new Error(`empty object body: ${key}`);
		}
		return response.Body.transformToByteArray();
	} catch (error) {
		if (isMissingObjectError(error)) {
			return;
		}
		throw error;
	}
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
