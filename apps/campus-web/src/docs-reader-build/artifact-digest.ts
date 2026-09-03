import { createHash } from "node:crypto";

export function canonicalJsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value), undefined, 2)}\n`);
}

export function sha256(value: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertSha256(value: string): `sha256:${string}` {
	if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new Error("docs source digest must be sha256:<64 lowercase hex characters>");
	}
	return value as `sha256:${string}`;
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, sortJson(child)]),
		);
	}
	return value;
}
