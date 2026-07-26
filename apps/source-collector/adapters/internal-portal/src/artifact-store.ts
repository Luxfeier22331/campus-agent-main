import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type {
	StoredArtifactHead as BaseStoredArtifactHead,
	StoredArtifactRef as BaseStoredArtifactRef,
} from "ingest-core";
import { createOrVerifyS3Object } from "../../../src/s3-create-or-verify.ts";

export type StoredArtifactRef = BaseStoredArtifactRef & {
	bucket: string;
	etag: string | null;
	versionId: string | null;
};

export type StoredArtifactHead = BaseStoredArtifactHead & {
	bucket: string;
	etag: string | null;
	versionId: string | null;
};

export interface AuthenticatedNoticeArtifactStore {
	readonly storageProvider: "object_store";
	close?(): Promise<void> | void;

	headObject(input: { abortSignal?: AbortSignal; objectKey: string }): Promise<StoredArtifactHead>;

	createOrVerifyObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		metadata?: Record<string, string>;
	}): Promise<StoredArtifactRef>;
}

class S3AuthenticatedNoticeArtifactStore implements AuthenticatedNoticeArtifactStore {
	readonly storageProvider = "object_store" as const;
	private readonly bucket: string;
	private readonly client: Pick<S3Client, "send"> & Partial<Pick<S3Client, "destroy">>;

	constructor(input: {
		bucket: string;
		client: Pick<S3Client, "send"> & Partial<Pick<S3Client, "destroy">>;
	}) {
		this.bucket = input.bucket;
		this.client = input.client;
	}

	close(): void {
		this.client.destroy?.();
	}

	async createOrVerifyObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
		data: Uint8Array;
		contentType: string;
		metadata?: Record<string, string>;
	}): Promise<StoredArtifactRef> {
		const stored = await createOrVerifyS3Object({
			abortSignal: input.abortSignal,
			body: input.data,
			bucket: this.bucket,
			client: this.client,
			contentType: input.contentType,
			key: input.objectKey,
			metadata: input.metadata,
		});
		return {
			bucket: this.bucket,
			objectKey: input.objectKey,
			contentSha256: stored.contentSha256,
			byteSize: stored.byteSize,
			etag: stored.etag,
			versionId: stored.versionId,
		};
	}

	async headObject(input: {
		abortSignal?: AbortSignal;
		objectKey: string;
	}): Promise<StoredArtifactHead> {
		const result = await this.client.send(
			new HeadObjectCommand({
				Bucket: this.bucket,
				Key: input.objectKey,
			}),
			{ abortSignal: input.abortSignal },
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
	client: Pick<S3Client, "send"> & Partial<Pick<S3Client, "destroy">>;
}): AuthenticatedNoticeArtifactStore {
	return new S3AuthenticatedNoticeArtifactStore(input);
}
