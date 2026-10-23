import { AppApiRouteError } from "../../http";

export interface DiningImageContainer {
	format: "image/jpeg" | "image/png" | "image/webp";
	width: number;
	height: number;
}

export function invalidDiningPhoto(): AppApiRouteError {
	return new AppApiRouteError({
		code: "dining_submission_photo_invalid",
		message: "Photo is damaged, animated, or exceeds the supported dimensions.",
		retryable: false,
		status: 422,
	});
}

export function assertImage(condition: unknown): asserts condition {
	if (!condition) {
		throw invalidDiningPhoto();
	}
}

export function imageDimensions(width: number, height: number): { width: number; height: number } {
	assertImage(width > 0 && height > 0 && width <= 4096 && height <= 4096);
	return { width, height };
}

export function imageView(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function imageTag(bytes: Uint8Array, offset: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit++) {
		value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value = (value >>> 8) ^ (crcTable[(value ^ byte) & 255] ?? 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}

export function hasPngSignature(bytes: Uint8Array): boolean {
	return pngSignature.every((value, index) => bytes[index] === value);
}

export function inspectPng(bytes: Uint8Array): DiningImageContainer {
	const view = imageView(bytes);
	let offset = 8;
	let dimensions: { width: number; height: number } | undefined;
	let color = -1;
	let palette = false;
	let dataStarted = false;
	let dataEnded = false;
	let dataSize = 0;
	while (offset < bytes.length) {
		assertImage(offset + 12 <= bytes.length);
		const length = view.getUint32(offset);
		const tag = imageTag(bytes, offset + 4);
		const start = offset + 8;
		const end = start + length;
		assertImage(end + 4 <= bytes.length && /^[A-Za-z]{4}$/.test(tag));
		assertImage(crc32(bytes.subarray(offset + 4, end)) === view.getUint32(end));
		assertImage(!["acTL", "fcTL", "fdAT"].includes(tag));
		if (!dimensions) {
			assertImage(tag === "IHDR" && length === 13);
		}
		if (tag === "IHDR") {
			assertImage(!dimensions && length === 13);
			dimensions = imageDimensions(view.getUint32(start), view.getUint32(start + 4));
			const depth = bytes[start + 8];
			color = bytes[start + 9] ?? -1;
			const depths: Record<number, readonly number[]> = {
				0: [1, 2, 4, 8, 16],
				2: [8, 16],
				3: [1, 2, 4, 8],
				4: [8, 16],
				6: [8, 16],
			};
			assertImage(depth !== undefined && depths[color]?.includes(depth));
			assertImage(bytes[start + 10] === 0 && bytes[start + 11] === 0);
			assertImage(bytes[start + 12] === 0 || bytes[start + 12] === 1);
		} else if (tag === "PLTE") {
			assertImage(!(palette || dataStarted) && color !== 0 && color !== 4);
			assertImage(length > 0 && length <= 768 && length % 3 === 0);
			palette = true;
		} else if (tag === "IDAT") {
			assertImage(!dataEnded && (color !== 3 || palette));
			dataStarted = true;
			dataSize += length;
		} else if (tag === "IEND") {
			assertImage(length === 0 && dataSize > 0 && end + 4 === bytes.length && dimensions);
			return { format: "image/png", ...dimensions };
		} else {
			// Unknown critical chunks change decoding and cannot be safely ignored.
			assertImage(tag[0] === tag[0]?.toLowerCase());
			if (dataStarted) {
				dataEnded = true;
			}
		}
		offset = end + 4;
	}
	throw invalidDiningPhoto();
}

export function inspectJpeg(bytes: Uint8Array): DiningImageContainer {
	const view = imageView(bytes);
	let offset = 2;
	let dimensions: { width: number; height: number } | undefined;
	let scanned = false;
	let inScan = false;
	while (offset < bytes.length) {
		if (inScan && bytes[offset] !== 0xff) {
			offset++;
			continue;
		}
		assertImage(bytes[offset++] === 0xff);
		while (bytes[offset] === 0xff) {
			offset++;
		}
		const marker = bytes[offset++];
		assertImage(marker !== undefined);
		if (inScan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) {
			continue;
		}
		inScan = false;
		if (marker === 0xd9) {
			assertImage(dimensions && scanned && offset === bytes.length);
			return { format: "image/jpeg", ...dimensions };
		}
		assertImage(marker !== 0 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7));
		if (marker === 0x01) {
			continue;
		}
		assertImage(offset + 2 <= bytes.length);
		const length = view.getUint16(offset);
		assertImage(length >= 2 && offset + length <= bytes.length);
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			assertImage(!dimensions && length >= 8);
			dimensions = imageDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
			const components = bytes[offset + 7] ?? 0;
			assertImage(components > 0 && length === 8 + 3 * components);
		}
		if (marker === 0xda) {
			assertImage(dimensions && length >= 6);
			const components = bytes[offset + 2] ?? 0;
			assertImage(components > 0 && length === 6 + 2 * components);
			scanned = true;
			inScan = true;
		}
		offset += length;
	}
	throw invalidDiningPhoto();
}
