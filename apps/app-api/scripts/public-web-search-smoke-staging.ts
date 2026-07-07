import process from "node:process";

import { expectJsonResponse } from "./smoke-auth-runtime";

interface PublicWebSearchSmokeArgs {
	baseUrl: string;
	maxResults: number;
	queries: string[];
	querySecret: string;
	accessClientId: string | null;
	accessClientSecret: string | null;
}

interface PublicWebSearchFetchInput {
	body: Record<string, unknown>;
	headers: Record<string, string>;
	url: string;
}

export interface PublicWebSearchSmokeDependencies {
	fetchJson?: (input: PublicWebSearchFetchInput) => Promise<Response>;
}

interface PublicWebSearchSmokeSample {
	model: string;
	provider: string;
	query: string;
	resultKind: string;
	sourceCount: number;
	sourceUrls: string[];
}

export interface PublicWebSearchSmokeResult {
	baseUrl: string;
	passed: boolean;
	samples: PublicWebSearchSmokeSample[];
}

const DEFAULT_QUERIES = [
	"校园网密码怎么改",
	"中央民族大学校园网怎么连接",
	"中央民族大学统一身份认证密码忘了怎么办",
];

const DEFAULT_MAX_RESULTS = 5;
const FORBIDDEN_PUBLIC_WEB_FIELDS = new Set([
	"provider_raw_response",
	"raw_html",
	"raw_payload",
	"raw_response",
	"source_body",
]);

function normalizeOptionalValue(value: string | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function requiredArg(value: string | undefined, name: string): string {
	const normalized = normalizeOptionalValue(value);
	if (!normalized) {
		throw new Error(`${name} requires a non-empty value.`);
	}
	return normalized;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): PublicWebSearchSmokeArgs {
	let baseUrl =
		normalizeOptionalValue(env.STAGING_EXECUTION_CONTROL_BASE_URL) ??
		normalizeOptionalValue(env.EXECUTION_CONTROL_BASE_URL) ??
		"";
	let querySecret =
		normalizeOptionalValue(env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET) ??
		normalizeOptionalValue(env.STAGING_EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET) ??
		"";
	let maxResults = DEFAULT_MAX_RESULTS;
	const queries: string[] = [];
	let accessClientId =
		normalizeOptionalValue(env.STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID) ??
		normalizeOptionalValue(env.EXECUTION_CONTROL_ACCESS_CLIENT_ID);
	let accessClientSecret =
		normalizeOptionalValue(env.STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET) ??
		normalizeOptionalValue(env.EXECUTION_CONTROL_ACCESS_CLIENT_SECRET);

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") {
			continue;
		}
		if (token === "--base-url") {
			baseUrl = requiredArg(argv[index + 1], "--base-url");
			index += 1;
			continue;
		}
		if (token === "--query") {
			queries.push(requiredArg(argv[index + 1], "--query"));
			index += 1;
			continue;
		}
		if (token === "--max-results") {
			const parsed = Number(requiredArg(argv[index + 1], "--max-results"));
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > DEFAULT_MAX_RESULTS) {
				throw new Error(`--max-results must be an integer between 1 and ${DEFAULT_MAX_RESULTS}.`);
			}
			maxResults = parsed;
			index += 1;
			continue;
		}
		if (token === "--query-auth-secret") {
			querySecret = requiredArg(argv[index + 1], "--query-auth-secret");
			index += 1;
			continue;
		}
		if (token === "--access-client-id") {
			accessClientId = requiredArg(argv[index + 1], "--access-client-id");
			index += 1;
			continue;
		}
		if (token === "--access-client-secret") {
			accessClientSecret = requiredArg(argv[index + 1], "--access-client-secret");
			index += 1;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}

	if (!baseUrl) {
		throw new Error(
			"STAGING_EXECUTION_CONTROL_BASE_URL or EXECUTION_CONTROL_BASE_URL is required.",
		);
	}
	if (!querySecret) {
		throw new Error(
			"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET or STAGING_EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET is required.",
		);
	}
	if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
		throw new Error("Cloudflare Access service token requires both client id and client secret.");
	}

	return {
		accessClientId,
		accessClientSecret,
		baseUrl: baseUrl.replace(/\/+$/u, ""),
		maxResults,
		queries: queries.length > 0 ? queries : DEFAULT_QUERIES,
		querySecret,
	};
}

async function postInternalJSON(input: PublicWebSearchFetchInput): Promise<Response> {
	return fetch(input.url, {
		body: JSON.stringify(input.body),
		headers: {
			accept: "application/json",
			"content-type": "application/json",
			...input.headers,
		},
		method: "POST",
		signal: AbortSignal.timeout(120_000),
	});
}

function searchEndpoint(args: PublicWebSearchSmokeArgs): string {
	return new URL("/internal/query/public-web/search", `${args.baseUrl}/`).toString();
}

function searchHeaders(args: PublicWebSearchSmokeArgs): Record<string, string> {
	return {
		...(args.accessClientId && args.accessClientSecret
			? {
					"CF-Access-Client-Id": args.accessClientId,
					"CF-Access-Client-Secret": args.accessClientSecret,
				}
			: {}),
		"x-execution-query-auth": args.querySecret,
	};
}

function assertNoForbiddenFields(value: unknown, path = "public_web_search"): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoForbiddenFields(item, `${path}[${index}]`);
		}
		return;
	}
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, nested] of Object.entries(value)) {
		if (FORBIDDEN_PUBLIC_WEB_FIELDS.has(key)) {
			throw new Error(`forbidden public_web_search field in ${path}: ${key}`);
		}
		assertNoForbiddenFields(nested, `${path}.${key}`);
	}
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${path} must be an object.`);
	}
	return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, field: string, path: string): string {
	const value = record[field];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${path}.${field} is required.`);
	}
	return value.trim();
}

function assertAllowedPublicMucURL(raw: string): void {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`disallowed public_web_search source url: ${raw}`);
	}
	const hostname = parsed.hostname.toLowerCase();
	const isMucHost = hostname === "muc.edu.cn" || hostname.endsWith(".muc.edu.cn");
	if (
		parsed.protocol !== "https:" ||
		parsed.port !== "" ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		!isMucHost ||
		hostname === "my.muc.edu.cn"
	) {
		throw new Error(`disallowed public_web_search source url: ${raw}`);
	}
}

function validatePayload(
	payload: unknown,
	query: string,
	maxResults: number,
): PublicWebSearchSmokeSample {
	assertNoForbiddenFields(payload);
	const record = requireRecord(payload, "public_web_search result");
	const failCloseReason = record.fail_close_reason;
	if (typeof failCloseReason === "string" && failCloseReason.trim()) {
		const message =
			typeof record.error === "object" && record.error !== null && "message" in record.error
				? String(record.error.message)
				: "";
		throw new Error(
			`public_web_search failed closed: ${failCloseReason.trim()}${message ? `: ${message}` : ""}`,
		);
	}
	const resultKind = requireString(record, "result_kind", "public_web_search result");
	if (resultKind !== "public_web_evidence") {
		throw new Error(
			`public_web_search result_kind is ${resultKind}, expected public_web_evidence.`,
		);
	}
	const provider = requireString(record, "provider", "public_web_search result");
	const model = requireString(record, "model", "public_web_search result");
	const sources = record.sources;
	if (!Array.isArray(sources) || sources.length === 0 || sources.length > maxResults) {
		throw new Error(`public_web_search sources must include 1-${maxResults} items.`);
	}

	const sourceUrls = sources.map((source, index) => {
		const sourceRecord = requireRecord(source, `public_web_search sources[${index}]`);
		if (
			requireString(sourceRecord, "source_kind", `public_web_search sources[${index}]`) !==
			"public_web"
		) {
			throw new Error(`public_web_search sources[${index}].source_kind must be public_web.`);
		}
		if (
			requireString(sourceRecord, "target_kind", `public_web_search sources[${index}]`) !==
			"public_web_url"
		) {
			throw new Error(`public_web_search sources[${index}].target_kind must be public_web_url.`);
		}
		requireString(sourceRecord, "title", `public_web_search sources[${index}]`);
		requireString(sourceRecord, "snippet", `public_web_search sources[${index}]`);
		requireString(sourceRecord, "evidence_id", `public_web_search sources[${index}]`);
		const url = requireString(sourceRecord, "url", `public_web_search sources[${index}]`);
		assertAllowedPublicMucURL(url);
		return url;
	});

	return {
		model,
		provider,
		query,
		resultKind,
		sourceCount: sources.length,
		sourceUrls,
	};
}

export async function runPublicWebSearchSmokeStaging(
	argv: string[],
	env: NodeJS.ProcessEnv = process.env,
	deps: PublicWebSearchSmokeDependencies = {},
): Promise<PublicWebSearchSmokeResult> {
	const args = parseArgs(argv, env);
	const fetchJson = deps.fetchJson ?? postInternalJSON;
	const samples: PublicWebSearchSmokeSample[] = [];

	for (const query of args.queries) {
		const response = await fetchJson({
			body: {
				payload: {
					max_results: args.maxResults,
					query_text: query,
				},
			},
			headers: searchHeaders(args),
			url: searchEndpoint(args),
		});
		const payload = await expectJsonResponse<unknown>(response, 200);
		samples.push(validatePayload(payload, query, args.maxResults));
	}

	return {
		baseUrl: args.baseUrl,
		passed: true,
		samples,
	};
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
	const result = await runPublicWebSearchSmokeStaging(argv, env);
	console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
