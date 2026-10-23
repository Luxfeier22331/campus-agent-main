import {
	DINING_SUBMISSION_PHOTO_MAX_INPUT_BYTES,
	DiningSubmissionCreateSchema,
	DiningSubmissionUpdateSchema,
} from "@campus-agent/dining/domain";
import { AppApiRouteError } from "../../http";

const METADATA_MAX_BYTES = 8 * 1024;
const MULTIPART_MAX_BYTES = DINING_SUBMISSION_PHOTO_MAX_INPUT_BYTES + 64 * 1024;

export function invalidSubmissionRequest(): AppApiRouteError {
	return new AppApiRouteError({
		code: "dining_submission_request_invalid",
		message: "投稿请求格式无效。",
		retryable: false,
		status: 400,
	});
}

function payloadTooLarge(): AppApiRouteError {
	return new AppApiRouteError({
		code: "dining_submission_payload_too_large",
		message: "投稿请求超过大小限制。",
		retryable: false,
		status: 413,
	});
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array> {
	if (!request.body) {
		throw invalidSubmissionRequest();
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel().catch(() => undefined);
				throw payloadTooLarge();
			}
			chunks.push(value);
		}
	} catch (error) {
		if (error instanceof AppApiRouteError) {
			throw error;
		}
		throw invalidSubmissionRequest();
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function parseMetadata(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw invalidSubmissionRequest();
	}
}

async function readSubmissionBody(request: Request) {
	const contentType = request.headers.get("content-type") ?? "";
	const encoding = contentType.split(";", 1)[0]?.trim().toLowerCase();
	if (
		request.headers.has("content-encoding") &&
		request.headers.get("content-encoding") !== "identity"
	) {
		throw invalidSubmissionRequest();
	}
	if (encoding !== "application/json" && encoding !== "multipart/form-data") {
		throw new AppApiRouteError({
			code: "dining_submission_media_unsupported",
			message: "投稿请求编码不受支持。",
			retryable: false,
			status: 415,
		});
	}
	const bytes = await readBoundedBody(
		request,
		encoding === "application/json" ? METADATA_MAX_BYTES : MULTIPART_MAX_BYTES,
	);
	if (encoding === "application/json") {
		let text: string;
		try {
			text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			throw invalidSubmissionRequest();
		}
		return { metadata: parseMetadata(text), photo: null, multipart: false };
	}
	let form: FormData;
	try {
		form = await new Response(new Uint8Array(bytes), {
			headers: { "content-type": contentType },
		}).formData();
	} catch {
		throw invalidSubmissionRequest();
	}
	const entries = [...form.entries()];
	if (
		entries.length !== 2 ||
		form.getAll("metadata").length !== 1 ||
		form.getAll("photo").length !== 1
	) {
		throw invalidSubmissionRequest();
	}
	const metadata = form.get("metadata");
	const photo = form.get("photo");
	if (typeof metadata !== "string" || !photo || typeof photo === "string" || photo.size === 0) {
		throw invalidSubmissionRequest();
	}
	if (
		new TextEncoder().encode(metadata).byteLength > METADATA_MAX_BYTES ||
		photo.size > DINING_SUBMISSION_PHOTO_MAX_INPUT_BYTES
	) {
		throw payloadTooLarge();
	}
	return {
		metadata: parseMetadata(metadata),
		photo: new Uint8Array(await photo.arrayBuffer()),
		multipart: true,
	};
}

export async function readSubmissionCreate(request: Request) {
	const body = await readSubmissionBody(request);
	const result = DiningSubmissionCreateSchema.safeParse(body.metadata);
	if (!result.success || (result.data.photoAction === "replace") !== body.multipart) {
		throw invalidSubmissionRequest();
	}
	return { metadata: result.data, photo: body.photo };
}

export async function readSubmissionUpdate(request: Request) {
	const body = await readSubmissionBody(request);
	const result = DiningSubmissionUpdateSchema.safeParse(body.metadata);
	if (!result.success || (result.data.photoAction === "replace") !== body.multipart) {
		throw invalidSubmissionRequest();
	}
	return { metadata: result.data, photo: body.photo };
}

export function submissionPathId(value: string | undefined): string {
	if (!(value && /^[A-Za-z0-9_-]{1,200}$/.test(value))) {
		throw invalidSubmissionRequest();
	}
	return value;
}

export function submissionWindowId(value: string | undefined): string {
	if (!value || value.length > 200 || value !== value.trim() || /[\s/\\\p{Cc}]/u.test(value)) {
		throw invalidSubmissionRequest();
	}
	return value;
}

export function submissionPagination(request: Request): { limit: number; cursor?: string } {
	const params = new URL(request.url).searchParams;
	const limit = params.get("limit");
	const cursor = params.get("cursor");
	if (
		params.getAll("limit").length > 1 ||
		params.getAll("cursor").length > 1 ||
		(limit !== null && (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > 50)) ||
		(cursor !== null && (!cursor || cursor.length > 2048))
	) {
		throw invalidSubmissionRequest();
	}
	return { limit: limit === null ? 20 : Number(limit), ...(cursor === null ? {} : { cursor }) };
}

export function submissionRevision(request: Request): number {
	const value = request.headers.get("if-match");
	if (value === null) {
		throw new AppApiRouteError({
			code: "dining_submission_revision_required",
			message: "请提供投稿当前版本。",
			retryable: false,
			status: 428,
		});
	}
	if (!/^"[1-9][0-9]*"$/.test(value)) {
		throw invalidSubmissionRequest();
	}
	const revision = Number(value.slice(1, -1));
	if (!Number.isSafeInteger(revision)) {
		throw invalidSubmissionRequest();
	}
	return revision;
}

export function submissionIdempotencyKey(request: Request): string {
	const key = request.headers.get("idempotency-key")?.trim();
	if (!key || key.length < 8 || key.length > 200) {
		throw new AppApiRouteError({
			code: "idempotency_key_invalid",
			message: "Idempotency-Key 必须为 8 至 200 个字符。",
			retryable: false,
			status: 400,
		});
	}
	return key;
}
