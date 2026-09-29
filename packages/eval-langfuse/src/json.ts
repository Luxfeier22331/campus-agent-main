import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type JsonObject = Record<string, unknown>;

export function loadJsonObject(path: string): JsonObject {
	const payload = JSON.parse(readFileSync(path, "utf-8")) as unknown;
	if (!isRecord(payload)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return payload;
}

export function writeJsonObject(path: string, payload: JsonObject): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

export function isRecord(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapping(value: unknown, field: string): JsonObject {
	if (!isRecord(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value;
}

export function mappingList(value: unknown, field: string): JsonObject[] {
	if (!Array.isArray(value)) {
		throw new Error(`${field} must be a list`);
	}
	return value.map((item) => {
		if (!isRecord(item)) {
			throw new Error(`${field} items must be objects`);
		}
		return item;
	});
}

export function stringField(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
	if (!normalized) {
		throw new Error(`${field} is required`);
	}
	return normalized;
}

export function optionalString(value: unknown): string | null {
	const normalized = typeof value === "string" ? value.trim() : String(value ?? "").trim();
	return normalized || null;
}

export function stringList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((item) => String(item).trim()).filter(Boolean);
}

export function requiredStringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${field} must be a list`);
	}
	return value.map((item) => String(item).trim()).filter(Boolean);
}
