import {
	type InternalPortalCredentialResolution,
	InternalPortalCredentialResolutionSchema,
} from "campus-contracts/internal-portal-credential";

const CREDENTIAL_RESOLUTION_PATH = "/internal/ops/internal-portal/credentials/resolve";

export interface OpsWebCredentialResolverEnv {
	OPS_WEB_INTERNAL_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class OpsWebCredentialResolverError extends Error {
	readonly code: string;
	readonly status: number | null;

	constructor(code: string, message: string, options: { cause?: unknown; status?: number } = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "OpsWebCredentialResolverError";
		this.code = code;
		this.status = options.status ?? null;
	}
}

export async function resolveInternalPortalCredential(input: {
	abortSignal?: AbortSignal;
	fetch?: typeof fetch;
	token: string;
	url: string;
}): Promise<InternalPortalCredentialResolution> {
	const url = resolveOpsWebUrl(input.url);
	const token = requiredValue(input.token, "OPS_WEB_INTERNAL_TOKEN");
	let response: Response;
	try {
		response = await (input.fetch ?? fetch)(new URL(CREDENTIAL_RESOLUTION_PATH, url), {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${token}`,
			},
			method: "POST",
			...(input.abortSignal === undefined ? {} : { signal: input.abortSignal }),
		});
	} catch (error) {
		throw new OpsWebCredentialResolverError(
			"OPS_INTERNAL_PORTAL_RESOLVER_UNREACHABLE",
			"无法连接 Ops Web 内部门户凭据解析接口。",
			{ cause: error },
		);
	}
	if (!response.ok) {
		const code = await readErrorCode(response);
		throw new OpsWebCredentialResolverError(
			code,
			`Ops Web 内部门户凭据解析失败（HTTP ${response.status}）。`,
			{ status: response.status },
		);
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new OpsWebCredentialResolverError(
			"OPS_INTERNAL_PORTAL_RESPONSE_INVALID",
			"Ops Web 内部门户凭据解析响应不是有效 JSON。",
			{ cause: error, status: response.status },
		);
	}
	const parsed = InternalPortalCredentialResolutionSchema.safeParse(payload);
	if (!parsed.success) {
		throw new OpsWebCredentialResolverError(
			"OPS_INTERNAL_PORTAL_RESPONSE_INVALID",
			"Ops Web 内部门户凭据解析响应不符合合同。",
			{ status: response.status },
		);
	}
	return parsed.data;
}

export async function resolveInternalPortalCredentialFromEnv(
	env: OpsWebCredentialResolverEnv,
	options: { abortSignal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<InternalPortalCredentialResolution> {
	return await resolveInternalPortalCredential({
		...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
		...(options.fetch === undefined ? {} : { fetch: options.fetch }),
		token: requiredValue(env.OPS_WEB_INTERNAL_TOKEN, "OPS_WEB_INTERNAL_TOKEN"),
		url: requiredValue(env.OPS_WEB_INTERNAL_URL, "OPS_WEB_INTERNAL_URL"),
	});
}

function resolveOpsWebUrl(raw: string): URL {
	const value = requiredValue(raw, "OPS_WEB_INTERNAL_URL");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new OpsWebCredentialResolverError(
			"OPS_INTERNAL_PORTAL_CONFIG_INVALID",
			"OPS_WEB_INTERNAL_URL 必须是 HTTP 或 HTTPS origin。",
		);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new OpsWebCredentialResolverError(
			"OPS_INTERNAL_PORTAL_CONFIG_INVALID",
			"OPS_WEB_INTERNAL_URL 必须是无凭据、无路径的 HTTP 或 HTTPS origin。",
		);
	}
	return url;
}

function requiredValue(value: string | undefined, key: string): string {
	const normalized = value?.trim() ?? "";
	if (!normalized) {
		throw new OpsWebCredentialResolverError(
			"OPS_INTERNAL_PORTAL_CONFIG_INVALID",
			`${key} is required.`,
		);
	}
	return normalized;
}

async function readErrorCode(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as unknown;
		if (
			typeof body === "object" &&
			body !== null &&
			"error" in body &&
			typeof body.error === "object" &&
			body.error !== null &&
			"code" in body.error &&
			typeof body.error.code === "string" &&
			body.error.code.length <= 100
		) {
			return body.error.code;
		}
	} catch {
		// The status remains enough to report a bounded failure.
	}
	return "OPS_INTERNAL_PORTAL_RESOLUTION_FAILED";
}
