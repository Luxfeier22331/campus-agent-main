import { type FetchAttachmentBinaryResult, fetchAttachmentBinary } from "./api.js";
import type { ApiRequestContextLike } from "./types.js";

const FILE_RELEASE_MAX_BYTES = 50 * 1024 * 1024;

export async function downloadAttachment(input: {
	abortSignal?: AbortSignal;
	apiContext: ApiRequestContextLike;
	attachmentUrl: string;
}): Promise<FetchAttachmentBinaryResult> {
	return await fetchAttachmentBinary({
		...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
		apiContext: input.apiContext,
		attachmentUrl: input.attachmentUrl,
		maxBytes: FILE_RELEASE_MAX_BYTES,
	});
}
