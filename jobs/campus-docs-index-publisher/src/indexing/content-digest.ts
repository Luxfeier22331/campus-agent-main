import { createHash } from "node:crypto";

import { compareCanonicalStrings } from "campus-contracts/canonical-order";

export function sha256Text(value: string): `sha256:${string}` {
	return sha256Bytes(new TextEncoder().encode(value));
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value), undefined, 2)}\n`);
}

export function sha256(value: Uint8Array): `sha256:${string}` {
	return sha256Bytes(value);
}

export function sha256Bytes(value: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableId(prefix: string, values: readonly string[]): string {
	const digest = createHash("sha256").update(values.join("\u0000")).digest("hex");
	return `${prefix}_${digest.slice(0, 40)}`;
}

export function stableUuid(values: readonly string[]): string {
	const digest = createHash("sha256").update(values.join("\u0000")).digest("hex");
	const variant = ((Number.parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => compareCanonicalStrings(left, right))
				.map(([key, child]) => [key, sortJson(child)]),
		);
	}
	return value;
}
