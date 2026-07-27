import type { Readable } from "node:stream";
import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { assertStoredArtifactIdentity, buildS3Uri, sha256Hex } from "ingest-core";

type S3ClientLike = Pick<S3Client, "send">;

export async function createOrVerifyS3Object(input: {
	abortSignal?: AbortSignal;
	body: Uint8Array | Readable;
	byteSize?: number;
	bucket: string;
	client: S3ClientLike;
	contentSha256?: string;
	contentType: string;
	key: string;
	metadata?: Record<string, string>;
}): Promise<{
	byteSize: number;
	contentSha256: string;
	etag: string | null;
	versionId: string | null;
}> {
	const bytePayload = input.body instanceof Uint8Array ? input.body : null;
	const computedSha256 = bytePayload ? sha256Hex(bytePayload) : null;
	const contentSha256 = input.contentSha256 ?? computedSha256;
	const byteSize = input.byteSize ?? bytePayload?.byteLength ?? null;
	if (!(contentSha256 && /^[0-9a-f]{64}$/u.test(contentSha256))) {
		throw new Error("streamed S3 object requires a lowercase SHA-256 digest");
	}
	if (!(Number.isSafeInteger(byteSize) && Number(byteSize) >= 0)) {
		throw new Error("streamed S3 object requires a non-negative byte size");
	}
	if (computedSha256 && input.contentSha256 && input.contentSha256 !== computedSha256) {
		throw new Error("provided S3 object digest does not match byte payload");
	}
	if (bytePayload && input.byteSize !== undefined && input.byteSize !== bytePayload.byteLength) {
		throw new Error("provided S3 object byte size does not match byte payload");
	}
	let putEtag: string | null = null;
	let putVersionID: string | null = null;
	try {
		const result = await input.client.send(
			new PutObjectCommand({
				Body: input.body,
				Bucket: input.bucket,
				ContentLength: Number(byteSize),
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
		expectedByteSize: Number(byteSize),
		expectedContentSha256: contentSha256,
		uri: buildS3Uri({ bucket: input.bucket, key: input.key }),
	});
	return {
		byteSize: Number(byteSize),
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
