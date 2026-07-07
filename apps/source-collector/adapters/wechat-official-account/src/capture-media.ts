import { sha256Hex } from "ingest-core";
import { extension as mimeExtension } from "mime-types";
import type { CapturedWeChatOfficialAccountArticleMedia } from "./core/index.ts";

export interface CapturedArticleMediaPayload extends CapturedWeChatOfficialAccountArticleMedia {
	contentType: string | null;
	imageBytes: Uint8Array | null;
	objectKeySeed: string;
}

export function buildCapturedArticleMediaPayload(input: {
	capturedAt: string;
	contentType: string | null;
	errorMessage: string | null;
	finalUrl: string | null;
	imageBytes: Uint8Array | null;
	normalizedSourceUrl: string;
	sourceUrl: string;
}): CapturedArticleMediaPayload {
	if (input.imageBytes && input.contentType) {
		return {
			byteSize: input.imageBytes.byteLength,
			captureStatus: "captured",
			capturedAt: input.capturedAt,
			contentSha256: sha256Hex(input.imageBytes),
			contentType: input.contentType,
			finalUrl: input.finalUrl,
			fetchErrorMessage: null,
			imageBytes: input.imageBytes,
			mimeType: input.contentType,
			normalizedSourceUrl: input.normalizedSourceUrl,
			objectKey: null,
			objectKeySeed: sha256Hex(input.normalizedSourceUrl).slice(0, 16),
			sourceUrl: input.sourceUrl,
		};
	}

	return {
		byteSize: null,
		captureStatus: "fetch_failed",
		capturedAt: input.capturedAt,
		contentSha256: null,
		contentType: null,
		finalUrl: null,
		fetchErrorMessage: input.errorMessage,
		imageBytes: null,
		mimeType: null,
		normalizedSourceUrl: input.normalizedSourceUrl,
		objectKey: null,
		objectKeySeed: sha256Hex(input.normalizedSourceUrl).slice(0, 16),
		sourceUrl: input.sourceUrl,
	};
}

export function inferImageExtension(input: { contentType: string; sourceUrl: string }): string {
	const direct = mimeExtension(input.contentType);
	if (direct) {
		return `.${direct}`;
	}
	const extension = /\.([a-z0-9]{1,8})(?:$|[?#])/i.exec(input.sourceUrl)?.[1];
	return extension ? `.${extension.toLowerCase()}` : ".bin";
}
