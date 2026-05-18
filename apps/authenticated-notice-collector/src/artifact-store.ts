import { createHash } from "node:crypto";

import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StoredArtifactRef {
	bucket: string;
	objectKey: string;
	contentSha256: string;
	byteSize: number;
	etag: string | null;
	versionId: string | null;
}

export interface StoredArtifactHead {
	bucket: string;
	objectKey: string;
	contentSha256: string | null;
	byteSize: number | null;
	etag: string | null;
	versionId: string | null;
}

export interface AuthenticatedNoticeArtifactStore {
	readonly storageProvider: "object_store";

	headObject(input: { objectKey: string }): Promise<StoredArtifactHead>;

	putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		metadata?: Record<string, string>;
	}): Promise<StoredArtifactRef>;
}

export interface AuthenticatedNoticeObjectStoreEnvironment {
	OBJECT_STORE_BUCKET_SOURCE?: string;
	OBJECT_STORE_ENDPOINT?: string;
	OBJECT_STORE_REGION?: string;
	OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
	OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

class S3AuthenticatedNoticeArtifactStore implements AuthenticatedNoticeArtifactStore {
	readonly storageProvider = "object_store" as const;
	private readonly bucket: string;
	private readonly client: Pick<S3Client, "send">;

	constructor(input: {
		bucket: string;
		client: Pick<S3Client, "send">;
	}) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	async putObject(input: {
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		metadata?: Record<string, string>;
	}): Promise<StoredArtifactRef> {
		const contentSha256 = createHash("sha256").update(input.data).digest("hex");
		const result = await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: input.objectKey,
				Body: input.data,
				ContentType: input.contentType,
				Metadata: {
					...input.metadata,
					"content-sha256": contentSha256,
				},
			}),
		);
		const head = await this.headObject({ objectKey: input.objectKey });
		assertStoredArtifactHeadMatchesPayload({
			byteSize: input.data.byteLength,
			contentSha256,
			head,
		});
		return {
			bucket: this.bucket,
			objectKey: input.objectKey,
			contentSha256,
			byteSize: input.data.byteLength,
			etag: result.ETag ?? null,
			versionId: result.VersionId ?? null,
		};
	}

	async headObject(input: { objectKey: string }): Promise<StoredArtifactHead> {
		const result = await this.client.send(
			new HeadObjectCommand({
				Bucket: this.bucket,
				Key: input.objectKey,
			}),
		);
		const metadata = result.Metadata ?? {};
		return {
			bucket: this.bucket,
			objectKey: input.objectKey,
			contentSha256: metadata["content-sha256"] ?? metadata.content_sha256 ?? null,
			byteSize: result.ContentLength ?? null,
			etag: result.ETag ?? null,
			versionId: result.VersionId ?? null,
		};
	}
}

export function createAuthenticatedNoticeArtifactStore(input: {
	bucket: string;
	client: Pick<S3Client, "send">;
}): AuthenticatedNoticeArtifactStore {
	return new S3AuthenticatedNoticeArtifactStore(input);
}

export function createAuthenticatedNoticeArtifactStoreFromEnv(
	env: AuthenticatedNoticeObjectStoreEnvironment = process.env,
): AuthenticatedNoticeArtifactStore | undefined {
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

	return createAuthenticatedNoticeArtifactStore({
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

function assertStoredArtifactHeadMatchesPayload(input: {
	byteSize: number;
	contentSha256: string;
	head: StoredArtifactHead;
}): void {
	if (input.head.byteSize !== null && input.head.byteSize !== input.byteSize) {
		throw new Error(
			`stored artifact size mismatch for ${input.head.objectKey}: expected ${input.byteSize}, got ${input.head.byteSize}`,
		);
	}
	if (
		input.head.contentSha256 !== null &&
		input.head.contentSha256.toLowerCase() !== input.contentSha256
	) {
		throw new Error(
			`stored artifact sha256 mismatch for ${input.head.objectKey}: expected ${input.contentSha256}, got ${input.head.contentSha256}`,
		);
	}
}
