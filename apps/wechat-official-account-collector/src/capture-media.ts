import type { CapturedWeChatOfficialAccountArticleMedia } from "wechat-official-account-core";

import { sha256Hex } from "./capture-hashing.ts";

const MIME_TYPE_EXTENSION: Record<string, string> = {
	"image/gif": ".gif",
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
};

export interface CapturedArticleMediaPayload extends CapturedWeChatOfficialAccountArticleMedia {
	contentType: string | null;
	imageBytes: Uint8Array | null;
	objectKeySeed: string;
}

export async function captureWeChatArticleMedia(input: {
	articleSourceUrl: string;
	coverImageUrl: string | null;
	fetchImplementation: typeof fetch;
	inlineImageUrls: string[];
	now: () => Date;
}): Promise<CapturedArticleMediaPayload[]> {
	const orderedUrls: Array<{ normalizedSourceUrl: string; sourceUrl: string }> = [];
	const seen = new Set<string>();
	for (const candidate of [input.coverImageUrl, ...input.inlineImageUrls]) {
		const sourceUrl = normalizeMediaUrl(candidate);
		if (!sourceUrl || seen.has(sourceUrl)) {
			continue;
		}
		seen.add(sourceUrl);
		orderedUrls.push({
			normalizedSourceUrl: sourceUrl,
			sourceUrl,
		});
	}
	const media: CapturedArticleMediaPayload[] = [];
	for (const item of orderedUrls) {
		const capturedAt = input.now().toISOString();
		try {
			const response = await input.fetchImplementation(item.sourceUrl, {
				headers: {
					accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
					"accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
					referer: input.articleSourceUrl,
					"user-agent":
						"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36",
				},
				redirect: "follow",
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const contentType = normalizeImageContentType(response.headers.get("content-type"));
			if (!contentType) {
				throw new Error("non-image content-type");
			}
			const imageBytes = new Uint8Array(await response.arrayBuffer());
			const finalUrl = normalizeMediaUrl(response.url) ?? item.normalizedSourceUrl;
			media.push({
				byteSize: imageBytes.byteLength,
				captureStatus: "captured",
				capturedAt,
				contentSha256: sha256Hex(imageBytes),
				contentType,
				finalUrl,
				fetchErrorMessage: null,
				imageBytes,
				mimeType: contentType,
				normalizedSourceUrl: item.normalizedSourceUrl,
				objectKey: null,
				objectKeySeed: sha256Hex(item.normalizedSourceUrl).slice(0, 16),
				sourceUrl: item.sourceUrl,
			});
		} catch (error) {
			media.push({
				byteSize: null,
				captureStatus: "fetch_failed",
				capturedAt,
				contentSha256: null,
				contentType: null,
				finalUrl: null,
				fetchErrorMessage: error instanceof Error ? error.message : String(error),
				imageBytes: null,
				mimeType: null,
				normalizedSourceUrl: item.normalizedSourceUrl,
				objectKey: null,
				objectKeySeed: sha256Hex(item.normalizedSourceUrl).slice(0, 16),
				sourceUrl: item.sourceUrl,
			});
		}
	}
	return media;
}

export function inferImageExtension(input: { contentType: string; sourceUrl: string }): string {
	const direct = MIME_TYPE_EXTENSION[input.contentType];
	if (direct) {
		return direct;
	}
	const extension = /\.([a-z0-9]{1,8})(?:$|[?#])/i.exec(input.sourceUrl)?.[1];
	return extension ? `.${extension.toLowerCase()}` : ".bin";
}

function normalizeMediaUrl(value: string | null | undefined): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		const parsed = new URL(value.trim());
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return null;
	}
}

function normalizeImageContentType(value: string | null): string | null {
	const normalized = String(value || "")
		.split(";", 1)[0]
		.trim()
		.toLowerCase();
	return normalized.startsWith("image/") ? normalized : null;
}
