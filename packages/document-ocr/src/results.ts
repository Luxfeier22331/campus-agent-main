import { downloadResource } from "./provider.ts";
import type { OcrObjects, OcrResult } from "./types.ts";

interface ParsedPage {
	text: string;
	images: Record<string, string>;
}
export class OcrResultError extends Error {}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseResult(jsonl: string): ParsedPage[] {
	const pages: ParsedPage[] = [];
	for (const line of jsonl.split("\n").filter((line) => line.trim())) {
		let item: unknown;
		try {
			item = JSON.parse(line);
		} catch {
			throw new OcrResultError("Paddle OCR result is not valid JSONL");
		}
		if (!record(item) || (item.errorCode !== undefined && item.errorCode !== 0)) {
			throw new OcrResultError("Paddle OCR result contains an error");
		}
		if (!(record(item.result) && Array.isArray(item.result.layoutParsingResults))) {
			throw new OcrResultError("Paddle OCR result is missing layoutParsingResults");
		}
		for (const page of item.result.layoutParsingResults) {
			if (!(record(page) && record(page.markdown)) || typeof page.markdown.text !== "string") {
				throw new OcrResultError("Paddle OCR page is missing markdown.text");
			}
			const images: Record<string, string> = {};
			if (record(page.markdown.images)) {
				for (const [name, url] of Object.entries(page.markdown.images)) {
					if (typeof url !== "string") {
						throw new OcrResultError("Invalid OCR image URL");
					}
					images[name] = url;
				}
			}
			pages.push({ text: page.markdown.text, images });
		}
	}
	if (pages.length === 0) {
		throw new OcrResultError("Paddle OCR returned no pages");
	}
	return pages;
}
export async function persistResult(
	taskId: string,
	raw: Uint8Array,
	objects: OcrObjects,
	options: { download?: (url: string) => Promise<Uint8Array>; allowMissingImages?: boolean } = {},
): Promise<OcrResult> {
	const prefix = `ocr/tasks/${taskId}`;
	const result: OcrResult = { rawKey: `${prefix}/result.jsonl`, pages: [], missingImages: [] };
	await objects.putDerived(result.rawKey, raw, "application/x-ndjson");
	const pages = parseResult(new TextDecoder().decode(raw));
	for (const [pageIndex, page] of pages.entries()) {
		let markdown = page.text;
		const images: string[] = [];
		for (const [imageIndex, [name, url]] of Object.entries(page.images).entries()) {
			// Provider filenames are never used as filesystem paths.
			const key = `${prefix}/images/${pageIndex}-${imageIndex}`;
			let bytes: Uint8Array;
			try {
				bytes = await objects.getDerived(key);
			} catch {
				try {
					bytes = await (options.download ?? downloadResource)(url);
				} catch (error) {
					if (!options.allowMissingImages) {
						throw error;
					}
					result.missingImages.push(name);
					continue;
				}
				await objects.putDerived(key, bytes, "application/octet-stream");
			}
			markdown = markdown.replaceAll(name, `images/${pageIndex}-${imageIndex}`);
			images.push(key);
		}
		const markdownKey = `${prefix}/page-${String(pageIndex).padStart(3, "0")}.md`;
		await objects.putDerived(
			markdownKey,
			new TextEncoder().encode(markdown),
			"text/markdown; charset=utf-8",
		);
		result.pages.push({ markdownKey, images });
	}
	return result;
}
