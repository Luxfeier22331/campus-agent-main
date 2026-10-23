import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Bounds, JsonObject } from "./map-model";

export function readJson(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

export function readFileBytes(filePath: string): Uint8Array {
	return new Uint8Array(readFileSync(filePath));
}

export function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value), null, "\t")}\n`);
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortJson);
	}
	if (!isObject(value)) {
		return value;
	}
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sortJson(value[key])]),
	);
}

export function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function readSafeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function visitCoordinates(
	value: unknown,
	visit: (coordinate: [number, number]) => void,
): void {
	if (!Array.isArray(value)) {
		throw new Error("GeoJSON coordinates must be arrays.");
	}
	if (
		value.length >= 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1])
	) {
		visit([value[0], value[1]]);
		return;
	}
	for (const child of value) {
		visitCoordinates(child, visit);
	}
}

export function isInsideBounds(
	coordinate: readonly [number, number],
	bounds: readonly [number, number, number, number],
): boolean {
	return (
		coordinate[0] >= bounds[0] &&
		coordinate[0] <= bounds[2] &&
		coordinate[1] >= bounds[1] &&
		coordinate[1] <= bounds[3]
	);
}

export function sameBounds(left: readonly number[], right: Bounds): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isBounds(value: unknown): value is Bounds {
	return (
		Array.isArray(value) &&
		value.length === 4 &&
		value.every((item) => typeof item === "number" && Number.isFinite(item)) &&
		value[0] < value[2] &&
		value[1] < value[3]
	);
}

export function digestFromManifestEntry(url: string | undefined): string {
	const digest = url?.match(/[0-9a-f]{64}/u)?.[0];
	return digest ?? "";
}

export function relativeAssetPath(url: string): string {
	const prefix = "/campus-map/";
	if (!url.startsWith(prefix)) {
		throw new Error(`Map asset URL is outside the static namespace: ${url}`);
	}
	return url.slice(prefix.length);
}
