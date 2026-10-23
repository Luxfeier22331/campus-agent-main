import type { Readable } from "node:stream";
import { HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

type S3ClientLike = Pick<S3Client, "send">;

/**
 * Write an object only when its key is still free. Content-addressed keys already name their
 * bytes, so an existing object is accepted as is. Fixed keys pass `identity`; it is stored as
 * metadata on create and compared on conflict, because a fixed key cannot prove its content.
 */
export async function createS3Object(input: {
	abortSignal?: AbortSignal;
	body: Uint8Array | Readable;
	byteSize?: number;
	bucket: string;
	client: S3ClientLike;
	contentType: string;
	identity?: { byteSize: number; contentSha256: string };
	key: string;
}): Promise<"created" | "existing"> {
	const options = input.abortSignal ? { abortSignal: input.abortSignal } : {};
	try {
		await input.client.send(
			new PutObjectCommand({
				Body: input.body,
				Bucket: input.bucket,
				ContentLength: input.byteSize ?? (input.body instanceof Uint8Array ? input.body.byteLength : undefined),
				ContentType: input.contentType,
				IfNoneMatch: "*",
				Key: input.key,
				...(input.identity
					? { Metadata: { "content-sha256": input.identity.contentSha256 } }
					: {}),
			}),
			options,
		);
		return "created";
	} catch (error) {
		if (!isPreconditionFailed(error)) {
			throw error;
		}
	}
	if (input.identity) {
		const existing = await input.client.send(
			new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
			options,
		);
		const existingSha256 =
			existing.Metadata?.["content-sha256"] ?? existing.Metadata?.content_sha256 ?? null;
		if (
			existing.ContentLength !== input.identity.byteSize ||
			existingSha256 !== input.identity.contentSha256
		) {
			throw new Error(
				`object identity collision at s3://${input.bucket}/${input.key}: expected sha256 ${input.identity.contentSha256} and ${input.identity.byteSize} bytes, got ${existingSha256 ?? "missing"} and ${existing.ContentLength ?? "missing"} bytes`,
			);
		}
	}
	return "existing";
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
