const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImageDimensions {
	height: number;
	width: number;
}

export function readPngDimensions(bytes: Uint8Array): ImageDimensions {
	if (bytes.byteLength < 24 || !hasPrefix(bytes, PNG_SIGNATURE)) {
		throw new Error("unsupported course map image format; expected PNG");
	}

	if (readAscii(bytes, 12, 4) !== "IHDR") {
		throw new Error("invalid PNG image: IHDR chunk is missing");
	}

	const width = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16);
	const height = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20);
	if (width === 0 || height === 0) {
		throw new Error("invalid PNG image: dimensions must be positive");
	}

	return { height, width };
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
	return prefix.every((value, index) => bytes[index] === value);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
