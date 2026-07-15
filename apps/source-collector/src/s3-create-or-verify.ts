import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { assertStoredArtifactIdentity, buildS3Uri, sha256Hex } from "ingest-core";

type S3ClientLike = Pick<S3Client, "send">;

export async function createOrVerifyS3Object(input: {
	abortSignal?: AbortSignal;
	body: Uint8Array;
	bucket: string;
	client: S3ClientLike;
	contentType: string;
	key: string;
	metadata?: Record<string, string>;
}): Promise<{
	byteSize: number;
	contentSha256: string;
	etag: string | null;
	versionId: string | null;
}> {
	const contentSha256 = sha256Hex(input.body);
	let putEtag: string | null = null;
	let putVersionID: string | null = null;
	try {
		const result = await input.client.send(
			new PutObjectCommand({
				Body: input.body,
				Bucket: input.bucket,
				ContentLength: input.body.byteLength,
				ContentType: input.contentType,
				IfNoneMatch: "*",
				Key: input.key,
				Metadata: { ...input.metadata, "content-sha256": contentSha256 },
			}),
			{ abortSignal: input.abortSignal },
		);
		putEtag = result.ETag ?? null;
		putVersionID = result.VersionId ?? null;
	} catch (error) {
		if (!isPreconditionFailed(error)) {
			throw error;
		}
	}

	const existing = await input.client.send(
		new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
		{ abortSignal: input.abortSignal },
	);
	assertStoredArtifactIdentity({
		actualByteSize: existing.ContentLength ?? null,
		actualContentSha256:
			existing.Metadata?.["content-sha256"] ?? existing.Metadata?.content_sha256 ?? null,
		expectedByteSize: input.body.byteLength,
		expectedContentSha256: contentSha256,
		uri: buildS3Uri({ bucket: input.bucket, key: input.key }),
	});
	return {
		byteSize: input.body.byteLength,
		contentSha256,
		etag: existing.ETag ?? putEtag,
		versionId: existing.VersionId ?? putVersionID,
	};
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
