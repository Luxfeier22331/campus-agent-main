import { createHash } from "node:crypto";

import type { Sha256Ref } from "./types.ts";

const encoder = new TextEncoder();

export function canonicalJsonBytes(value: unknown): Uint8Array {
	return encoder.encode(`${JSON.stringify(sortJson(value))}\n`);
}

export function encodeNdjson(records: readonly unknown[]): Uint8Array {
	if (records.length === 0) {
		throw new Error("notice chunk NDJSON must contain at least one record");
	}
	return encoder.encode(
		`${records.map((record) => JSON.stringify(sortJson(record))).join("\n")}\n`,
	);
}

export function sha256(bytes: Uint8Array | string): Sha256Ref {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function unicodeLength(value: string): number {
	return [...value].length;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (!isRecord(value)) {
		return value;
	}
	return Object.fromEntries(
		Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, sortJson(item)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
