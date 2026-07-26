import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import {
	type ArtifactWriteInput,
	type ArtifactWriteResult,
	assertStoredArtifactIdentity,
	type ObjectStore,
	type ObjectStoreLocation,
	sha256Hex,
} from "ingest-core";

export interface IngestionObjectStore extends ObjectStore {
	readonly derivedBucket: string;
	readonly sourceBucket: string;
	close?(): Promise<void> | void;
	getObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<Uint8Array>;
	headObject(
		input: ObjectStoreLocation & { abortSignal?: AbortSignal },
	): Promise<{ byteSize: number | null; contentSha256: string | null }>;
	createOrVerifyObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult>;
}

export interface IngestionObjectStoreEnvironment {
	OBJECT_STORE_DERIVED_ACCESS_KEY?: string;
	OBJECT_STORE_DERIVED_SECRET_KEY?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

type S3ClientLike = Pick<S3Client, "send"> & Partial<Pick<S3Client, "destroy">>;

export function createS3IngestionObjectStore(input: {
	bucket: string;
	client: S3ClientLike;
}): IngestionObjectStore {
	return new S3IngestionObjectStore(
		new Map([[input.bucket, input.client]]),
		input.bucket,
		input.bucket,
	);
}

export function createS3IngestionObjectStoreFromEnv(
	env: IngestionObjectStoreEnvironment = process.env,
): IngestionObjectStore | undefined {
	const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
	const sourceAccessKey = env.OBJECT_STORE_SOURCE_ACCESS_KEY?.trim();
	const sourceSecretKey = env.OBJECT_STORE_SOURCE_SECRET_KEY?.trim();
	const derivedAccessKey = env.OBJECT_STORE_DERIVED_ACCESS_KEY?.trim();
	const derivedSecretKey = env.OBJECT_STORE_DERIVED_SECRET_KEY?.trim();
	const configuredCount = [
		endpoint,
		sourceAccessKey,
		sourceSecretKey,
		derivedAccessKey,
		derivedSecretKey,
	].filter(Boolean).length;

	if (configuredCount === 0) {
		return;
	}
	if (!(endpoint && sourceAccessKey && sourceSecretKey && derivedAccessKey && derivedSecretKey)) {
		throw new Error(
			"ingestion worker requires OBJECT_STORE_ENDPOINT plus source and derived object-store credentials",
		);
	}
	const sourceBucket = "campus-agent-source";
	const derivedBucket = "campus-agent-derived";
	const createClient = (accessKeyId: string, secretAccessKey: string) =>
		new S3Client({
			endpoint,
			region: "us-east-1",
			credentials: { accessKeyId, secretAccessKey },
			forcePathStyle: true,
		});
	return new S3IngestionObjectStore(
		new Map([
			[sourceBucket, createClient(sourceAccessKey, sourceSecretKey)],
			[derivedBucket, createClient(derivedAccessKey, derivedSecretKey)],
		]),
		derivedBucket,
		sourceBucket,
	);
}

class S3IngestionObjectStore implements IngestionObjectStore {
	readonly derivedBucket: string;
	readonly sourceBucket: string;
	private readonly clients: ReadonlyMap<string, S3ClientLike>;

	constructor(
		clients: ReadonlyMap<string, S3ClientLike>,
		derivedBucket: string,
		sourceBucket: string,
	) {
		this.clients = clients;
		this.derivedBucket = derivedBucket;
		this.sourceBucket = sourceBucket;
	}

	close(): void {
		for (const client of new Set(this.clients.values())) {
			client.destroy?.();
		}
	}

	async getObject(input: ObjectStoreLocation & { abortSignal?: AbortSignal }): Promise<Uint8Array> {
		const result = await this.requireClient(input.bucket).send(
			new GetObjectCommand({
				Bucket: input.bucket,
				Key: input.key,
			}),
			{ abortSignal: input.abortSignal },
		);
		const body = result.Body;
		if (!body) {
			throw new Error(`object body missing: s3://${input.bucket}/${input.key}`);
		}
		if (typeof body.transformToByteArray === "function") {
			return body.transformToByteArray();
		}
		throw new Error(`object body is not byte-readable: s3://${input.bucket}/${input.key}`);
	}

	async createOrVerifyObject(
		input: ArtifactWriteInput & { abortSignal?: AbortSignal },
	): Promise<ArtifactWriteResult> {
		const contentSha256 = sha256Hex(input.body);
		try {
			await this.requireClient(input.bucket).send(
				new PutObjectCommand({
					Bucket: input.bucket,
					Key: input.key,
					Body: input.body,
					ContentLength: input.body.byteLength,
					ContentType: input.contentType,
					IfNoneMatch: "*",
					Metadata: { ...input.metadata, "content-sha256": contentSha256 },
				}),
				{ abortSignal: input.abortSignal },
			);
		} catch (error) {
			if (!isPreconditionFailed(error)) {
				throw error;
			}
			const existing = await this.headObject(input);
			assertStoredArtifactIdentity({
				actualByteSize: existing.byteSize,
				actualContentSha256: existing.contentSha256,
				expectedByteSize: input.body.byteLength,
				expectedContentSha256: contentSha256,
				uri: `s3://${input.bucket}/${input.key}`,
			});
		}
		return {
			byteSize: input.body.byteLength,
			contentSha256,
		};
	}

	async headObject(
		input: ObjectStoreLocation & { abortSignal?: AbortSignal },
	): Promise<{ byteSize: number | null; contentSha256: string | null }> {
		const result = await this.requireClient(input.bucket).send(
			new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
			{ abortSignal: input.abortSignal },
		);
		return {
			byteSize: result.ContentLength ?? null,
			contentSha256: result.Metadata?.["content-sha256"] ?? result.Metadata?.content_sha256 ?? null,
		};
	}

	private requireClient(bucket: string): S3ClientLike {
		const client = this.clients.get(bucket);
		if (!client) {
			throw new Error(`object bucket is not configured for ingestion: ${bucket}`);
		}
		return client;
	}
}

function isPreconditionFailed(error: unknown): boolean {
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
		candidate.$metadata?.httpStatusCode === 412 ||
		candidate.name === "PreconditionFailed" ||
		candidate.Code === "PreconditionFailed" ||
		candidate.code === "PreconditionFailed"
	);
}
