import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { ReaderObjectStore, WritableObjectStore } from "./types.ts";

export const DEFAULT_DERIVED_BUCKET = "campus-agent-derived";

export interface ObjectStoreEnv {
	OBJECT_STORE_BUCKET_DERIVED?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_DERIVED_READ_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_READ_SECRET_KEY?: string;
}

export function createS3ReaderStore(env: ObjectStoreEnv = process.env): ReaderObjectStore {
	const bucket = env.OBJECT_STORE_BUCKET_DERIVED?.trim() || DEFAULT_DERIVED_BUCKET;
	const client = createClient({
		accessKeyId: requiredEnv(
			env.OBJECT_STORE_DERIVED_READ_ACCESS_KEY,
			"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
		),
		bucket,
		endpoint: requiredEnv(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT"),
		secretAccessKey: requiredEnv(
			env.OBJECT_STORE_DERIVED_READ_SECRET_KEY,
			"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
		),
	});
	return {
		read: (key) => readObject(client, bucket, key),
	};
}

export function createS3ReaderStoreFromConfig(config: S3ObjectStoreConfig, signal?: AbortSignal): ReaderObjectStore {
	const client = createClient(config);
	return { read: (key) => readObject(client, config.bucket, key, signal) };
}

export function createS3WriterStore(env: ObjectStoreEnv = process.env): WritableObjectStore {
	const bucket = requiredEnv(env.OBJECT_STORE_BUCKET_DERIVED, "OBJECT_STORE_BUCKET_DERIVED");
	const config: S3ObjectStoreConfig = {
		accessKeyId: requiredEnv(env.OBJECT_STORE_DERIVED_ACCESS_KEY, "OBJECT_STORE_DERIVED_ACCESS_KEY"),
		bucket,
		endpoint: requiredEnv(env.OBJECT_STORE_ENDPOINT, "OBJECT_STORE_ENDPOINT"),
		secretAccessKey: requiredEnv(
			env.OBJECT_STORE_DERIVED_SECRET_KEY,
			"OBJECT_STORE_DERIVED_SECRET_KEY",
		),
	};
	const client = createClient(config);
	return {
		read: (key) => readObject(client, bucket, key),
		async readIfExists(key) {
			try {
				return await readObject(client, bucket, key);
			} catch (error) {
				if (isNotFound(error)) return undefined;
				throw error;
			}
		},
		async writeImmutable(key, body, contentType) {
			try {
				await client.send(
					new PutObjectCommand({
						Body: body,
						Bucket: bucket,
						ContentType: contentType ?? contentTypeForKey(key),
						IfNoneMatch: "*",
						Key: key,
					}),
				);
				return "created";
			} catch (error) {
				if (!isPreconditionFailure(error)) throw error;
			}
			const existing = await readObject(client, bucket, key);
			if (!Buffer.from(existing).equals(Buffer.from(body))) {
				throw new Error(`immutable object conflicts with existing content: ${key}`);
			}
			return "existing";
		},
	};
}

export interface S3ObjectStoreConfig {
	accessKeyId: string;
	bucket: string;
	endpoint: string;
	secretAccessKey: string;
}

function createClient(config: S3ObjectStoreConfig): S3Client {
	return new S3Client({
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
		endpoint: config.endpoint,
		forcePathStyle: true,
		region: "us-east-1",
	});
}

async function readObject(client: S3Client, bucket: string, key: string, signal?: AbortSignal): Promise<Uint8Array> {
	const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), signal ? { abortSignal: signal } : {});
	if (!response.Body) throw new Error(`object body is missing: ${key}`);
	return response.Body.transformToByteArray();
}

function contentTypeForKey(key: string): string {
	return key.endsWith(".ndjson") ? "application/x-ndjson" : "application/json";
}

function isNotFound(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
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

function isPreconditionFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as {
		$metadata?: { httpStatusCode?: number };
		Code?: string;
		code?: string;
		name?: string;
	};
	return (
		candidate.$metadata?.httpStatusCode === 412 ||
		candidate.name === "PreconditionFailed" ||
		candidate.Code === "PreconditionFailed" ||
		candidate.code === "PreconditionFailed"
	);
}

function requiredEnv(value: string | undefined, name: string): string {
	const normalized = value?.trim();
	if (!normalized) throw new Error(`${name} is required for Campus RAG publisher object storage`);
	return normalized;
}
