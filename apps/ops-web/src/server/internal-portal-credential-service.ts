import {
	type InternalPortalCredential,
	InternalPortalCredentialListSchema,
	InternalPortalCredentialResponseSchema,
	InternalPortalCredentialRevealSchema,
} from "campus-contracts/internal-portal-credential";

const CREDENTIALS_PATH = "/internal/ingestion/internal-portal/credentials";

export interface InternalPortalCredentialClientEnv {
	INGESTION_CONTROL_INTERNAL_URL?: string;
	OPS_WEB_INTERNAL_TOKEN?: string;
}

export class InternalPortalCandidateInputError extends Error {
	constructor() {
		super("SSO_TGC 或 Cookie 格式无效。");
		this.name = "InternalPortalCandidateInputError";
	}
}

export class InternalPortalCandidateRejectedError extends Error {
	constructor() {
		super("内部门户拒绝了该 SSO_TGC，请确认凭据仍可登录。");
		this.name = "InternalPortalCandidateRejectedError";
	}
}

export class InternalPortalCandidateCheckFailedError extends Error {
	constructor() {
		super("暂时无法连接内部门户验证该 SSO_TGC。");
		this.name = "InternalPortalCandidateCheckFailedError";
	}
}

export class InternalPortalCredentialStoreUnavailableError extends Error {
	constructor(message = "内部门户凭据服务不可用。", options?: ErrorOptions) {
		super(message, options);
		this.name = "InternalPortalCredentialStoreUnavailableError";
	}
}

export class InternalPortalCredentialNotFoundError extends Error {
	constructor() {
		super("未找到内部门户凭据。");
		this.name = "InternalPortalCredentialNotFoundError";
	}
}

export class InternalPortalCredentialConflictError extends Error {
	constructor() {
		super("内部门户凭据已被其他操作更新，请刷新后重试。");
		this.name = "InternalPortalCredentialConflictError";
	}
}

export class InternalPortalCredentialNameConflictError extends Error {
	constructor() {
		super("已存在同名内部门户凭据，请使用其他名称。");
		this.name = "InternalPortalCredentialNameConflictError";
	}
}

export interface InternalPortalCredentialService {
	create(
		input: { name: string; ssoTgc: string },
		signal?: AbortSignal,
	): Promise<InternalPortalCredential>;
	delete(credentialId: string, expectedVersion: number): Promise<void>;
	list(): Promise<InternalPortalCredential[]>;
	rename(
		credentialId: string,
		name: string,
		expectedVersion: number,
	): Promise<InternalPortalCredential>;
	reveal(credentialId: string): Promise<{
		credentialId: string;
		ssoTgc: string;
		version: number;
	}>;
	rotate(
		credentialId: string,
		ssoTgc: string,
		expectedVersion: number,
		signal?: AbortSignal,
	): Promise<InternalPortalCredential>;
	validate(credentialId: string, signal?: AbortSignal): Promise<InternalPortalCredential>;
}

export function createUnavailableInternalPortalCredentialService(
	error: unknown,
): InternalPortalCredentialService {
	const fail = async (): Promise<never> => {
		throw error instanceof InternalPortalCredentialStoreUnavailableError
			? error
			: new InternalPortalCredentialStoreUnavailableError(undefined, { cause: error });
	};
	return {
		create: fail,
		delete: fail,
		list: fail,
		rename: fail,
		reveal: fail,
		rotate: fail,
		validate: fail,
	};
}

export function createInternalPortalCredentialService(
	env: InternalPortalCredentialClientEnv,
	options: { fetch?: typeof fetch } = {},
): InternalPortalCredentialService {
	const origin = parseOrigin(env.INGESTION_CONTROL_INTERNAL_URL);
	const token = requiredValue(env.OPS_WEB_INTERNAL_TOKEN, "OPS_WEB_INTERNAL_TOKEN");
	const request = async (
		path: string,
		init: RequestInit = {},
	): Promise<{ response: Response; value: unknown }> => {
		let response: Response;
		try {
			response = await (options.fetch ?? fetch)(new URL(path, origin), {
				...init,
				headers: {
					accept: "application/json",
					authorization: `Bearer ${token}`,
					...init.headers,
				},
			});
		} catch (error) {
			throw new InternalPortalCredentialStoreUnavailableError(undefined, { cause: error });
		}
		let value: unknown = null;
		if (response.status !== 204) {
			try {
				value = await response.json();
			} catch (error) {
				throw new InternalPortalCredentialStoreUnavailableError(undefined, { cause: error });
			}
		}
		if (!response.ok) {
			throw mapResponseError(value);
		}
		return { response, value };
	};

	return {
		async create(input, signal) {
			const { value } = await request(CREDENTIALS_PATH, {
				body: JSON.stringify(input),
				headers: { "content-type": "application/json" },
				method: "POST",
				...(signal ? { signal } : {}),
			});
			return parseUpstreamResponse(InternalPortalCredentialResponseSchema, value).credential;
		},
		async delete(credentialId, expectedVersion) {
			await request(`${CREDENTIALS_PATH}/${credentialId}`, {
				headers: { "if-match": `"${expectedVersion}"` },
				method: "DELETE",
			});
		},
		async list() {
			const { value } = await request(CREDENTIALS_PATH);
			return parseUpstreamResponse(InternalPortalCredentialListSchema, value).credentials;
		},
		async rename(credentialId, name, expectedVersion) {
			const { value } = await request(`${CREDENTIALS_PATH}/${credentialId}`, {
				body: JSON.stringify({ name }),
				headers: {
					"content-type": "application/json",
					"if-match": `"${expectedVersion}"`,
				},
				method: "PUT",
			});
			return parseUpstreamResponse(InternalPortalCredentialResponseSchema, value).credential;
		},
		async reveal(credentialId) {
			const { value } = await request(`${CREDENTIALS_PATH}/${credentialId}/reveal`, {
				method: "POST",
			});
			return parseUpstreamResponse(InternalPortalCredentialRevealSchema, value);
		},
		async rotate(credentialId, ssoTgc, expectedVersion, signal) {
			const { value } = await request(`${CREDENTIALS_PATH}/${credentialId}`, {
				body: JSON.stringify({ ssoTgc }),
				headers: {
					"content-type": "application/json",
					"if-match": `"${expectedVersion}"`,
				},
				method: "PUT",
				...(signal ? { signal } : {}),
			});
			return parseUpstreamResponse(InternalPortalCredentialResponseSchema, value).credential;
		},
		async validate(credentialId, signal) {
			const { value } = await request(`${CREDENTIALS_PATH}/${credentialId}/validate`, {
				method: "POST",
				...(signal ? { signal } : {}),
			});
			return parseUpstreamResponse(InternalPortalCredentialResponseSchema, value).credential;
		},
	};
}

function parseUpstreamResponse<T>(
	schema: { safeParse(value: unknown): { data: T; success: true } | { success: false } },
	value: unknown,
): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new InternalPortalCredentialStoreUnavailableError(
			"ingestion-control returned an invalid credential response.",
		);
	}
	return parsed.data;
}

function mapResponseError(value: unknown): Error {
	const code = readErrorCode(value);
	switch (code) {
		case "INGESTION_INTERNAL_PORTAL_INPUT_INVALID":
			return new InternalPortalCandidateInputError();
		case "INGESTION_INTERNAL_PORTAL_CREDENTIAL_REJECTED":
			return new InternalPortalCandidateRejectedError();
		case "INGESTION_INTERNAL_PORTAL_CHECK_FAILED":
			return new InternalPortalCandidateCheckFailedError();
		case "INGESTION_INTERNAL_PORTAL_NOT_FOUND":
			return new InternalPortalCredentialNotFoundError();
		case "INGESTION_INTERNAL_PORTAL_CONFLICT":
			return new InternalPortalCredentialConflictError();
		case "INGESTION_INTERNAL_PORTAL_NAME_CONFLICT":
			return new InternalPortalCredentialNameConflictError();
		default:
			return new InternalPortalCredentialStoreUnavailableError();
	}
}

function readErrorCode(value: unknown): string | null {
	if (
		typeof value === "object" &&
		value !== null &&
		"error" in value &&
		typeof value.error === "object" &&
		value.error !== null &&
		"code" in value.error &&
		typeof value.error.code === "string"
	) {
		return value.error.code;
	}
	return null;
}

function parseOrigin(value: string | undefined): URL {
	const normalized = requiredValue(value, "INGESTION_CONTROL_INTERNAL_URL");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch (error) {
		throw new InternalPortalCredentialStoreUnavailableError(
			"INGESTION_CONTROL_INTERNAL_URL is invalid.",
			{ cause: error },
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
		throw new InternalPortalCredentialStoreUnavailableError(
			"INGESTION_CONTROL_INTERNAL_URL must be an HTTP or HTTPS origin.",
		);
	}
	return url;
}

function requiredValue(value: string | undefined, key: string): string {
	const normalized = value?.trim() ?? "";
	if (!normalized) {
		throw new InternalPortalCredentialStoreUnavailableError(`${key} is required.`);
	}
	return normalized;
}
