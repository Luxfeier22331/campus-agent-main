import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PutObjectCommand, type PutObjectCommandInput, S3Client } from "@aws-sdk/client-s3";

const RETRYABLE_PUT_ERROR_CODES = new Set([
	"IncompleteBody",
	"InternalError",
	"RequestTimeout",
	"RequestTimeoutException",
	"SlowDown",
	"SlowDownWrite",
]);
const DEFAULT_MAX_PUT_ATTEMPTS = 4;
const DEFAULT_RETRY_BACKOFF_MS = 100;

type SleepFn = (ms: number) => Promise<void>;

export interface StoredArtifactRef {
	objectKey: string;
	contentSha256: string;
	byteSize: number;
	recordCount?: number;
}

export interface OfficialWebArtifactStore {
	putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef>;
}

export interface OfficialWebObjectStoreEnvironment {
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

export class FilesystemArtifactStore implements OfficialWebArtifactStore {
	private readonly rootDir: string;

	constructor(rootDir: string) {
		this.rootDir = rootDir;
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const targetPath = resolve(this.rootDir, input.objectKey);
		mkdirSync(dirname(targetPath), { recursive: true });
		writeFileSync(targetPath, input.data);
		return {
			objectKey: input.objectKey,
			contentSha256: createHash("sha256").update(input.data).digest("hex"),
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

export class S3ArtifactStore implements OfficialWebArtifactStore {
	private readonly bucket: string;
	private readonly client: Pick<S3Client, "send">;
	private readonly maxPutAttempts: number;
	private readonly retryBackoffMs: number;
	private readonly sleep: SleepFn;

	constructor(input: {
		bucket: string;
		client: Pick<S3Client, "send">;
		maxPutAttempts?: number;
		retryBackoffMs?: number;
		sleep?: SleepFn;
	}) {
		this.bucket = input.bucket;
		this.client = input.client;
		this.maxPutAttempts = Math.max(1, input.maxPutAttempts ?? DEFAULT_MAX_PUT_ATTEMPTS);
		this.retryBackoffMs = Math.max(0, input.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS);
		this.sleep = input.sleep ?? defaultSleep;
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		recordCount?: number;
	}): Promise<StoredArtifactRef> {
		const commandInput: PutObjectCommandInput = {
			Bucket: this.bucket,
			Key: input.objectKey,
			Body: input.data,
			ContentType: input.contentType,
			ContentLength: input.data.byteLength,
		};
		for (let attempt = 1; ; attempt += 1) {
			try {
				await this.client.send(new PutObjectCommand(commandInput));
				break;
			} catch (error) {
				if (!isRetryablePutError(error) || attempt >= this.maxPutAttempts) {
					throw error;
				}
				await this.sleep(retryDelayMs(this.retryBackoffMs, attempt));
			}
		}
		return {
			objectKey: input.objectKey,
			contentSha256: createHash("sha256").update(input.data).digest("hex"),
			byteSize: input.data.byteLength,
			recordCount: input.recordCount,
		};
	}
}

export function createS3ArtifactStoreFromEnv(
	env: OfficialWebObjectStoreEnvironment = process.env,
): OfficialWebArtifactStore | undefined {
	const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
	const accessKey = env.OBJECT_STORE_SOURCE_ACCESS_KEY?.trim();
	const secretKey = env.OBJECT_STORE_SOURCE_SECRET_KEY?.trim();
	const configuredCount = [endpoint, accessKey, secretKey].filter(Boolean).length;

	if (configuredCount === 0) {
		return;
	}
	if (!(endpoint && accessKey && secretKey)) {
		throw new Error(
			"OBJECT_STORE_ENDPOINT plus OBJECT_STORE_SOURCE_ACCESS_KEY and OBJECT_STORE_SOURCE_SECRET_KEY are required for source-bucket uploads.",
		);
	}

	return new S3ArtifactStore({
		bucket: env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-rag-source",
		client: new S3Client({
			endpoint,
			region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
			credentials: {
				accessKeyId: accessKey,
				secretAccessKey: secretKey,
			},
			forcePathStyle: true,
		}),
	});
}

function retryDelayMs(baseMs: number, attempt: number): number {
	if (attempt <= 0 || baseMs <= 0) {
		return 0;
	}
	return baseMs * 2 ** (attempt - 1);
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function isRetryablePutError(error: unknown): boolean {
	if (error === null || typeof error !== "object") {
		return false;
	}
	const record = error as {
		name?: unknown;
		Code?: unknown;
		code?: unknown;
		$metadata?: { httpStatusCode?: unknown };
	};
	const code = String(record.Code ?? record.code ?? record.name ?? "").trim();
	const httpStatusCode = Number(record.$metadata?.httpStatusCode ?? 0);
	return RETRYABLE_PUT_ERROR_CODES.has(code) || httpStatusCode === 503;
}
