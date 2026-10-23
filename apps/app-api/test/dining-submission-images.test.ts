import { describe, expect, it, vi } from "vitest";

import { imageTag, imageView } from "../src/modules/dining/submission-image-container";
import { inspectWebp } from "../src/modules/dining/submission-image-webp";
import {
	createDiningImageProcessor,
	DINING_PHOTO_MAX_BYTES,
} from "../src/modules/dining/submission-images";

// Actual 2×1 images encoded once with Pillow. Binding responses below are mocked;
// these tests exercise validation and orchestration, not Cloudflare's real decoder.
const png = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8z8DQwMDAwAAACooBge1WxT4AAAAASUVORK5CYII=",
		"base64",
	),
);
const webp = Uint8Array.from(
	Buffer.from(
		"UklGRloAAABXRUJQVlA4WAoAAAAQAAAAAQAAAAAAQUxQSAMAAAAAgIAAVlA4IDAAAADQAQCdASoCAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
		"base64",
	),
);
const jpeg = Uint8Array.from(
	Buffer.from(
		"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z",
		"base64",
	),
);

function bindingWith(result: Uint8Array = webp) {
	const image = vi.fn(() => new Blob([Uint8Array.from(result)]).stream());
	const output = vi.fn(async () => ({
		contentType: () => "image/webp",
		image,
		response: () => new Response(Uint8Array.from(result)),
	}));
	const transform = vi.fn(() => ({ output }));
	const input = vi.fn(() => ({ transform }));
	return { binding: { input } as unknown as ImagesBinding, image, input, transform, output };
}

function pngChunk(tag: string, data: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(12 + data.length);
	imageView(chunk).setUint32(0, data.length);
	chunk.set(new TextEncoder().encode(tag), 4);
	chunk.set(data, 8);
	let crc = 0xffffffff;
	for (const byte of chunk.subarray(4, chunk.length - 4)) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
	}
	imageView(chunk).setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
	return chunk;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	return Uint8Array.from(Buffer.concat(parts));
}

function appendWebpChunk(bytes: Uint8Array, tag: string, content: Uint8Array): Uint8Array {
	const chunk = new Uint8Array(8 + content.length + (content.length % 2));
	chunk.set(new TextEncoder().encode(tag));
	imageView(chunk).setUint32(4, content.length, true);
	chunk.set(content, 8);
	const result = concat(bytes, chunk);
	imageView(result).setUint32(4, result.length - 8, true);
	return result;
}

describe("Dining submission Images processor", () => {
	it.each([
		["PNG", png],
		["JPEG", jpeg],
		["WebP", webp],
	])("validates %s bytes and fully consumes a static WebP transformation", async (_, bytes) => {
		const mock = bindingWith();
		const result = await createDiningImageProcessor(mock.binding).normalize(bytes);
		expect(result).toEqual({ bytes: webp, width: 2, height: 1 });
		expect(mock.transform).toHaveBeenCalledWith({ width: 1600, height: 1600, fit: "scale-down" });
		expect(mock.output).toHaveBeenCalledWith({ format: "image/webp" });
		expect(mock.image).toHaveBeenCalledOnce();
	});

	it("rejects unsupported real bytes and oversized uploads before conversion", async () => {
		const mock = bindingWith();
		const processor = createDiningImageProcessor(mock.binding);
		await expect(processor.normalize(new TextEncoder().encode("GIF89a"))).rejects.toMatchObject({
			status: 415,
			code: "dining_submission_media_unsupported",
		});
		await expect(
			processor.normalize(new Uint8Array(DINING_PHOTO_MAX_BYTES + 1)),
		).rejects.toMatchObject({
			status: 413,
			code: "dining_submission_payload_too_large",
		});
		expect(mock.input).not.toHaveBeenCalled();
	});

	it.each([
		["PNG", png],
		["JPEG", jpeg],
		["WebP", webp],
	])("rejects a truncated %s container", async (_, bytes) => {
		const mock = bindingWith();
		await expect(
			createDiningImageProcessor(mock.binding).normalize(bytes.subarray(0, bytes.length - 1)),
		).rejects.toMatchObject({ status: 422, code: "dining_submission_photo_invalid" });
		expect(mock.input).not.toHaveBeenCalled();
	});

	it("rejects a PNG CRC mismatch, oversized dimensions, and APNG control/frame chunks", async () => {
		const damaged = png.slice();
		damaged[45] = (damaged[45] ?? 0) ^ 1;
		const header = png.slice(16, 29);
		imageView(header).setUint32(0, 4097);
		const oversized = concat(png.subarray(0, 8), pngChunk("IHDR", header), png.subarray(33));
		for (const bytes of [
			damaged,
			oversized,
			...["acTL", "fcTL", "fdAT"].map((tag) =>
				concat(png.subarray(0, 33), pngChunk(tag, new Uint8Array(8)), png.subarray(33)),
			),
		]) {
			await expect(createDiningImageProcessor().normalize(bytes)).rejects.toMatchObject({
				status: 422,
			});
		}
	});

	it("rejects WebP animation flags and animation chunks even without a flag", async () => {
		const animatedFlag = webp.slice();
		animatedFlag[20] = (animatedFlag[20] ?? 0) | 2;
		for (const bytes of [
			animatedFlag,
			appendWebpChunk(webp, "ANIM", new Uint8Array(6)),
			appendWebpChunk(webp, "ANMF", new Uint8Array(16)),
		]) {
			await expect(createDiningImageProcessor().normalize(bytes)).rejects.toMatchObject({
				status: 422,
			});
		}
	});

	it("rejects canvas/frame mismatches and oversized JPEG frames", async () => {
		const mismatch = webp.slice();
		mismatch[24] = 2;
		await expect(createDiningImageProcessor().normalize(mismatch)).rejects.toMatchObject({
			status: 422,
		});
		const oversizedJpeg = jpeg.slice();
		const frameOffset = Buffer.from(jpeg).indexOf(Buffer.from([0xff, 0xc0]));
		expect(frameOffset).toBeGreaterThan(0);
		imageView(oversizedJpeg).setUint16(frameOffset + 7, 4097);
		await expect(createDiningImageProcessor().normalize(oversizedJpeg)).rejects.toMatchObject({
			status: 422,
		});
	});

	it("rejects bytes appended after a complete JPEG or PNG", async () => {
		for (const bytes of [png, jpeg]) {
			await expect(
				createDiningImageProcessor().normalize(concat(bytes, new Uint8Array([0]))),
			).rejects.toMatchObject({ status: 422 });
		}
	});

	it("fails closed when the binding is missing or an unknown provider error occurs", async () => {
		await expect(createDiningImageProcessor().normalize(png)).rejects.toMatchObject({
			status: 503,
			code: "dining_submission_image_unavailable",
			retryable: true,
		});
		const mock = bindingWith();
		mock.output.mockRejectedValue(new Error("provider secret diagnostic"));
		await expect(createDiningImageProcessor(mock.binding).normalize(png)).rejects.toMatchObject({
			status: 503,
			message: "Photo processing is temporarily unavailable.",
		});
	});

	it("maps the provider's explicit invalid-image code to a non-retryable input error", async () => {
		const mock = bindingWith();
		mock.output.mockRejectedValue(
			Object.assign(new Error("decoder rejected compressed data"), { code: 9412 }),
		);
		await expect(createDiningImageProcessor(mock.binding).normalize(png)).rejects.toMatchObject({
			status: 422,
			code: "dining_submission_photo_invalid",
			retryable: false,
		});
	});

	it("rejects failed output streams and invalid or animated provider output as dependency failures", async () => {
		const mock = bindingWith();
		mock.image.mockImplementation(
			() =>
				new ReadableStream({
					start(controller) {
						controller.enqueue(webp.subarray(0, 40));
						controller.error(new Error("connection closed"));
					},
				}),
		);
		await expect(createDiningImageProcessor(mock.binding).normalize(png)).rejects.toMatchObject({
			status: 503,
		});
		for (const bytes of [
			png,
			appendWebpChunk(webp, "ANIM", new Uint8Array(6)),
			webp.subarray(0, 30),
		]) {
			await expect(
				createDiningImageProcessor(bindingWith(bytes).binding).normalize(png),
			).rejects.toMatchObject({
				status: 503,
			});
		}
	});

	it("rejects a transformation that exceeds 1600 pixels instead of publishing it", async () => {
		const oversized = webp.slice();
		oversized[24] = 0x40;
		oversized[25] = 0x06;
		const frame = inspectWebp(webp).chunks.find((chunk) => chunk.tag === "VP8 ");
		expect(frame).toBeDefined();
		imageView(oversized).setUint16((frame?.offset ?? 0) + 14, 1601, true);
		await expect(
			createDiningImageProcessor(bindingWith(oversized).binding).normalize(png),
		).rejects.toMatchObject({ status: 503, code: "dining_submission_image_unavailable" });
	});

	it("removes EXIF, XMP and unknown output metadata while preserving the alpha rendering chunk", async () => {
		let metadata = appendWebpChunk(webp, "EXIF", new TextEncoder().encode("Exif GPS private"));
		metadata = appendWebpChunk(metadata, "XMP ", new TextEncoder().encode("XMP private"));
		metadata = appendWebpChunk(metadata, "data", new TextEncoder().encode("unknown private"));
		metadata[20] = (metadata[20] ?? 0) | 0x0c;
		const result = await createDiningImageProcessor(bindingWith(metadata).binding).normalize(png);
		expect(result.bytes).toEqual(webp);
		expect(
			inspectWebp(result.bytes).chunks.map((chunk) => imageTag(result.bytes, chunk.offset)),
		).toEqual(["VP8X", "ALPH", "VP8 "]);
	});
});
