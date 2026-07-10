import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type {
	PublishedReaderObjectStoreConfig,
	PublishedReaderObjectStoreCredentials,
	PublishedReaderObjectStoreEnv,
	ReaderObjectStoreClient,
} from "./published-reader-types.ts";

export function createS3ObjectStore(): ReaderObjectStoreClient {
	const { accessKeyId, bucket, endpoint, region, secretAccessKey } =
		resolvePublishedReaderObjectStoreConfig(process.env);
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
		async readTextObject(input: { key: string }) {
			const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: input.key }));
			if (!response.Body) {
				throw new Error(`empty object body: ${input.key}`);
			}
			return new TextDecoder().decode(await response.Body.transformToByteArray());
		},
	};
}

export function resolvePublishedReaderObjectStoreConfig(
	env: PublishedReaderObjectStoreEnv,
): PublishedReaderObjectStoreConfig {
	const endpoint = readRequiredEnv(env, "OBJECT_STORE_ENDPOINT");
	const bucket = resolvePublishedReaderObjectStoreBucket(env);
	const region = env.OBJECT_STORE_REGION?.trim() || "us-east-1";
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

export function resolvePublishedReaderObjectStoreBucket(
	env: Pick<PublishedReaderObjectStoreEnv, "OBJECT_STORE_BUCKET_DERIVED">,
): string {
	return readRequiredEnv(env, "OBJECT_STORE_BUCKET_DERIVED");
}

export function resolvePublishedReaderObjectStoreCredentials(
	env: PublishedReaderObjectStoreEnv,
): PublishedReaderObjectStoreCredentials {
	const derivedAccessKey = env.OBJECT_STORE_DERIVED_ACCESS_KEY?.trim();
	const derivedSecretKey = env.OBJECT_STORE_DERIVED_SECRET_KEY?.trim();
	if (derivedAccessKey && derivedSecretKey) {
		return {
			accessKeyId: derivedAccessKey,
			credentialMode: "derived",
			secretAccessKey: derivedSecretKey,
		};
	}
	const sharedAccessKey = env.OBJECT_STORE_ACCESS_KEY?.trim();
	const sharedSecretKey = env.OBJECT_STORE_SECRET_KEY?.trim();
	if (sharedAccessKey && sharedSecretKey) {
		return {
			accessKeyId: sharedAccessKey,
			credentialMode: "shared",
			secretAccessKey: sharedSecretKey,
		};
	}
	throw new Error(
		"missing object-store credentials: provide OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY or OBJECT_STORE_DERIVED_ACCESS_KEY/OBJECT_STORE_DERIVED_SECRET_KEY",
	);
}

function isMissingObjectError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			(("name" in error && error.name === "NoSuchKey") ||
				("Code" in error && error.Code === "NoSuchKey") ||
				("Code" in error && error.Code === "NotFound") ||
				hasHttpStatusCode(error, 404)),
	);
}

function hasHttpStatusCode(error: object, statusCode: number): boolean {
	if (!("$metadata" in error && error.$metadata) || typeof error.$metadata !== "object") {
		return false;
	}
	return "httpStatusCode" in error.$metadata && error.$metadata.httpStatusCode === statusCode;
}

function readRequiredEnv(
	env: PublishedReaderObjectStoreEnv,
	name: keyof PublishedReaderObjectStoreEnv,
): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required for campus docs published reader sync`);
	}
	return value;
}
