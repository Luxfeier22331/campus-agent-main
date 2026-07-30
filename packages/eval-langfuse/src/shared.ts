import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface LangfuseSettings {
	baseUrl: string;
	publicKey: string;
	secretKey: string;
	timeoutSeconds?: number;
}

export type JsonObject = Record<string, unknown>;

export class LangfuseRequestError extends Error {
	readonly statusCode: number;

	constructor(statusCode: number, message: string) {
		super(`Langfuse request failed: ${statusCode} ${message}`);
		this.statusCode = statusCode;
	}
}

export function settingsFromEnv(
	input: { env?: NodeJS.ProcessEnv; timeoutSeconds?: number } = {},
): LangfuseSettings {
	const env = input.env ?? process.env;
	return {
		baseUrl: stringField(env.LANGFUSE_BASE_URL, "LANGFUSE_BASE_URL"),
		publicKey: stringField(env.LANGFUSE_PUBLIC_KEY, "LANGFUSE_PUBLIC_KEY"),
		secretKey: stringField(env.LANGFUSE_SECRET_KEY, "LANGFUSE_SECRET_KEY"),
		timeoutSeconds: input.timeoutSeconds ?? 10,
	};
}

export function assertCompleteSettings(settings: LangfuseSettings): void {
	const populated = [settings.baseUrl, settings.publicKey, settings.secretKey].map((value) =>
		Boolean(value.trim()),
	);
	if (populated.some(Boolean) && !populated.every(Boolean)) {
		throw new Error("Langfuse adapter requires base URL, public and secret keys");
	}
	if (!populated.every(Boolean)) {
		throw new Error("Langfuse adapter is disabled");
	}
	if ((settings.timeoutSeconds ?? 10) <= 0) {
		throw new Error("Langfuse adapter timeout_seconds must be greater than zero");
	}
}

export function basicAuth(publicKey: string, secretKey: string): string {
	return `Basic ${Buffer.from(`${publicKey.trim()}:${secretKey.trim()}`).toString("base64")}`;
}

export async function requestJson(input: {
	body?: JsonObject;
	fetchImpl?: typeof fetch;
	method: string;
	path: string;
	query?: Record<string, unknown>;
	settings: LangfuseSettings;
}): Promise<JsonObject> {
	assertCompleteSettings(input.settings);
	const fetchImpl = input.fetchImpl ?? fetch;
	const url = new URL(`${input.settings.baseUrl.trim().replace(/\/+$/u, "")}${input.path}`);
	for (const [key, value] of Object.entries(input.query ?? {})) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}
	const response = await fetchImpl(url, {
		body: input.body ? JSON.stringify(input.body) : undefined,
		headers: {
			authorization: basicAuth(input.settings.publicKey, input.settings.secretKey),
			...(input.body ? { "content-type": "application/json" } : {}),
		},
		method: input.method,
	});
	if (response.status >= 400) {
		throw new LangfuseRequestError(response.status, await response.text());
	}
	const text = await response.text();
	if (!text.trim()) {
		return {};
	}
	const payload = JSON.parse(text) as unknown;
	if (!isRecord(payload)) {
		throw new Error("Langfuse response must be a JSON object");
	}
	return payload;
}

export async function listPaginated(input: {
	fetchImpl?: typeof fetch;
	path: string;
	query?: Record<string, unknown>;
	settings: LangfuseSettings;
}): Promise<JsonObject[]> {
	const items: JsonObject[] = [];
	for (let page = 1; ; page += 1) {
		const payload = await requestJson({
			fetchImpl: input.fetchImpl,
			method: "GET",
			path: input.path,
			query: { ...(input.query ?? {}), limit: 50, page },
			settings: input.settings,
		});
		items.push(...mappingList(payload.data, "data"));
		const meta = isRecord(payload.meta) ? payload.meta : {};
		const totalPages = Number(meta.totalPages ?? meta.total_pages ?? page);
		if (page >= totalPages) {
			return items;
		}
	}
}

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

export function requireEqual(actual: unknown, expected: unknown, field: string): void {
	if (actual !== expected) {
		throw new Error(`${field} must be ${expected}`);
	}
}

export function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value: unknown): string {
	return sha256Text(JSON.stringify(value, Object.keys(isRecord(value) ? value : {}).sort()));
}

export function sha256Bytes(value: Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

export function slug(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.toLowerCase();
}

export function stableId(prefix: string, ...parts: unknown[]): string {
	return `${slug(prefix)}:${sha256Text(parts.map(String).join(":")).slice(0, 24)}`;
}
