import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";

export const COURSE_MAP_IMAGE = createPngImage(1233, 649);

function createPngImage(width: number, height: number): Uint8Array {
	const rowSize = width + 1;
	const raw = Buffer.alloc(rowSize * height, 232);
	for (let row = 0; row < height; row += 1) {
		raw[row * rowSize] = 0;
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		createPngChunk("IHDR", ihdr),
		createPngChunk("IDAT", deflateSync(raw)),
		createPngChunk("IEND", Buffer.alloc(0)),
	]);
}

function createPngChunk(type: string, data: Uint8Array): Buffer {
	const typeBytes = Buffer.from(type, "ascii");
	const dataBytes = Buffer.from(data);
	const chunk = Buffer.alloc(12 + dataBytes.length);
	chunk.writeUInt32BE(dataBytes.length, 0);
	typeBytes.copy(chunk, 4);
	dataBytes.copy(chunk, 8);
	chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, dataBytes])), 8 + dataBytes.length);
	return chunk;
}

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
		}
	}
	return (value ^ 0xffffffff) >>> 0;
}
