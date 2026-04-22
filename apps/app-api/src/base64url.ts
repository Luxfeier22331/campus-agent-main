const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

export function encodeBase64UrlBytes(bytes: Uint8Array): string {
	return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

export function decodeBase64UrlBytes(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const paddingLength = (4 - (normalized.length % 4 || 4)) % 4;

	return decodeBase64(`${normalized}${"=".repeat(paddingLength)}`);
}

export function encodeBase64UrlUtf8(value: string): string {
	return encodeBase64UrlBytes(utf8Encoder.encode(value));
}

export function decodeBase64UrlUtf8(value: string): string {
	return utf8Decoder.decode(decodeBase64UrlBytes(value));
}

export function encodeBase64UrlJson(value: unknown): string {
	return encodeBase64UrlUtf8(JSON.stringify(value));
}

export function decodeBase64UrlJson<T>(value: string): T {
	return JSON.parse(decodeBase64UrlUtf8(value)) as T;
}
