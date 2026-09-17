import {
	assertImage,
	type DiningImageContainer,
	imageDimensions,
	imageTag,
	imageView,
} from "./submission-image-container";

interface WebpChunk {
	tag: string;
	offset: number;
	end: number;
	length: number;
}

export interface DiningWebpContainer extends DiningImageContainer {
	chunks: WebpChunk[];
}

export function hasWebpSignature(bytes: Uint8Array): boolean {
	return imageTag(bytes, 0) === "RIFF" && imageTag(bytes, 8) === "WEBP";
}

function uint24(bytes: Uint8Array, offset: number): number {
	return (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 256 + (bytes[offset + 2] ?? 0) * 65536;
}

export function inspectWebp(bytes: Uint8Array): DiningWebpContainer {
	const view = imageView(bytes);
	assertImage(bytes.length >= 20 && hasWebpSignature(bytes));
	assertImage(view.getUint32(4, true) + 8 === bytes.length);
	let offset = 12;
	let canvas: { width: number; height: number } | undefined;
	let frame: { width: number; height: number } | undefined;
	let alpha = false;
	let flags = 0;
	const chunks: WebpChunk[] = [];
	while (offset < bytes.length) {
		assertImage(offset + 8 <= bytes.length);
		const tag = imageTag(bytes, offset);
		const length = view.getUint32(offset + 4, true);
		const start = offset + 8;
		const end = start + length + (length % 2);
		assertImage(end <= bytes.length && (length % 2 === 0 || bytes[end - 1] === 0));
		assertImage(tag !== "ANIM" && tag !== "ANMF");
		if (tag === "VP8X") {
			assertImage(offset === 12 && length === 10);
			flags = bytes[start] ?? 0;
			assertImage((flags & 0xc3) === 0);
			assertImage(bytes[start + 1] === 0 && bytes[start + 2] === 0 && bytes[start + 3] === 0);
			canvas = imageDimensions(uint24(bytes, start + 4) + 1, uint24(bytes, start + 7) + 1);
		} else if (tag === "VP8 ") {
			assertImage(!frame && length >= 10 && (bytes[start] ?? 1) % 2 === 0);
			assertImage(bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a);
			frame = imageDimensions(
				view.getUint16(start + 6, true) & 0x3fff,
				view.getUint16(start + 8, true) & 0x3fff,
			);
		} else if (tag === "VP8L") {
			assertImage(!(frame || alpha) && length >= 5 && bytes[start] === 0x2f);
			const bits = view.getUint32(start + 1, true);
			assertImage(bits >>> 29 === 0);
			frame = imageDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
		} else if (tag === "ALPH") {
			assertImage(canvas && !frame && !alpha && length > 1);
			alpha = true;
		} else if (["ICCP", "EXIF", "XMP "].includes(tag)) {
			assertImage(canvas && !chunks.some((chunk) => chunk.tag === tag) && length > 0);
		}
		chunks.push({ tag, offset, end, length });
		offset = end;
	}
	assertImage(frame);
	assertImage(!canvas || (canvas.width === frame.width && canvas.height === frame.height));
	assertImage(!alpha || (flags & 0x10) !== 0);
	for (const [tag, flag] of [
		["ICCP", 0x20],
		["EXIF", 0x08],
		["XMP ", 0x04],
	] as const) {
		assertImage(chunks.some((chunk) => chunk.tag === tag) === ((flags & flag) !== 0));
	}
	return { format: "image/webp", ...frame, chunks };
}

/** Retain rendering chunks only; EXIF (including GPS), XMP and unknown metadata never leave the processor. */
export function stripWebpMetadata(bytes: Uint8Array, container: DiningWebpContainer): Uint8Array {
	const kept = container.chunks.filter((chunk) =>
		["VP8X", "ICCP", "ALPH", "VP8 ", "VP8L"].includes(chunk.tag),
	);
	const output = new Uint8Array(
		12 + kept.reduce((total, chunk) => total + chunk.end - chunk.offset, 0),
	);
	output.set(bytes.subarray(0, 12));
	imageView(output).setUint32(4, output.length - 8, true);
	let offset = 12;
	for (const chunk of kept) {
		output.set(bytes.subarray(chunk.offset, chunk.end), offset);
		if (chunk.tag === "VP8X") {
			output[offset + 8] = (output[offset + 8] ?? 0) & ~0x0c;
		}
		offset += chunk.end - chunk.offset;
	}
	return output;
}
