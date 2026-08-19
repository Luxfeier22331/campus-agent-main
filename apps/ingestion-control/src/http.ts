import { createHash, timingSafeEqual } from "node:crypto";
import {
	InternalPortalCredentialCreateSchema,
	InternalPortalCredentialListSchema,
	InternalPortalCredentialResolutionSchema,
	InternalPortalCredentialRevealSchema,
	InternalPortalCredentialSchema,
	InternalPortalCredentialUpdateSchema,
} from "campus-contracts/internal-portal-credential";
import { z } from "zod";
import { InternalPortalCandidateInputError } from "./internal-portal-candidate-input.ts";
import {
	InternalPortalCandidateCheckFailedError,
	InternalPortalCandidateRejectedError,
	InternalPortalCredentialResolutionUnavailableError,
	type InternalPortalCredentialService,
} from "./internal-portal-credential-service.ts";
import {
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
	InternalPortalCredentialNotFoundError,
	InternalPortalCredentialStoreUnavailableError,
} from "./internal-portal-credential-store.ts";

export type IngestionControlHandler = (request: Request) => Promise<Response>;

const CREDENTIALS_PATH = "/internal/ingestion/internal-portal/credentials";
const CredentialIdSchema = z.string().uuid();

export function createIngestionControlHandler(input: {
	credentialService: InternalPortalCredentialService;
	internalToken?: string | null;
	readinessCheck?: () => Promise<void>;
}): IngestionControlHandler {
	const internalToken = input.internalToken?.trim() || null;
	return async (request): Promise<Response> => {
		const url = new URL(request.url);
		try {
			if (request.method === "GET" && url.pathname === "/healthz") {
				return jsonResponse({ status: "ok" });
			}
			if (request.method === "GET" && url.pathname === "/readyz") {
				try {
					await input.readinessCheck?.();
				} catch {
					return jsonResponse({ status: "unavailable" }, 503);
				}
				return jsonResponse({ status: "ready" });
			}

			requireToken(request, internalToken);
			if (url.search) {
				throw new InternalPortalRequestError(
					"INGESTION_INTERNAL_PORTAL_INPUT_INVALID",
					"内部门户凭据接口不接受查询参数。",
					400,
				);
			}

			if (request.method === "GET" && url.pathname === CREDENTIALS_PATH) {
				return credentialResponse(
					InternalPortalCredentialListSchema.parse({
						credentials: await input.credentialService.list(),
					}),
				);
			}
			if (request.method === "POST" && url.pathname === CREDENTIALS_PATH) {
				const body = InternalPortalCredentialCreateSchema.safeParse(await readJson(request));
				if (!body.success) {
					throw invalidInput();
				}
				const credential = InternalPortalCredentialSchema.parse(
					await input.credentialService.create(body.data, request.signal),
				);
				return credentialResponse({ credential }, 201, credential.version);
			}
			if (request.method === "POST" && url.pathname === `${CREDENTIALS_PATH}/resolve`) {
				await requireEmptyBody(request);
				return credentialResponse(
					InternalPortalCredentialResolutionSchema.parse({
						schemaVersion: "internal-portal-credential-resolution.v1",
						ssoTgc: await input.credentialService.resolve(request.signal),
					}),
				);
			}

			const match = url.pathname.match(
				/^\/internal\/ingestion\/internal-portal\/credentials\/([^/]+)(?:\/(validate|reveal))?$/u,
			);
			if (!match?.[1]) {
				return jsonResponse({ error: { code: "INGESTION_ROUTE_NOT_FOUND" } }, 404);
			}
			const credentialId = CredentialIdSchema.safeParse(match[1]);
			if (!credentialId.success) {
				throw invalidInput();
			}

			if (request.method === "PUT" && !match[2]) {
				const expectedVersion = requireExpectedVersion(request);
				const body = InternalPortalCredentialUpdateSchema.safeParse(await readJson(request));
				if (!body.success) {
					throw invalidInput();
				}
				const credential = InternalPortalCredentialSchema.parse(
					"name" in body.data
						? await input.credentialService.rename(
								credentialId.data,
								body.data.name,
								expectedVersion,
							)
						: await input.credentialService.rotate(
								credentialId.data,
								body.data.ssoTgc,
								expectedVersion,
								request.signal,
							),
				);
				return credentialResponse({ credential }, 200, credential.version);
			}
			if (request.method === "DELETE" && !match[2]) {
				await requireEmptyBody(request);
				await input.credentialService.delete(credentialId.data, requireExpectedVersion(request));
				return new Response(null, { status: 204, headers: noStoreHeaders() });
			}
			if (request.method === "POST" && match[2] === "validate") {
				await requireEmptyBody(request);
				const credential = InternalPortalCredentialSchema.parse(
					await input.credentialService.validate(credentialId.data, request.signal),
				);
				return credentialResponse({ credential }, 200, credential.version);
			}
			if (request.method === "POST" && match[2] === "reveal") {
				await requireEmptyBody(request);
				const revealed = InternalPortalCredentialRevealSchema.parse(
					await input.credentialService.reveal(credentialId.data),
				);
				return credentialResponse(revealed, 200, revealed.version);
			}

			return jsonResponse({ error: { code: "INGESTION_ROUTE_NOT_FOUND" } }, 404);
		} catch (error) {
			return internalPortalErrorResponse(error);
		}
	};
}

class IngestionAuthenticationError extends Error {
	readonly status: 401 | 503;

	constructor(message: string, status: 401 | 503) {
		super(message);
		this.status = status;
	}
}

class InternalPortalRequestError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, message: string, status: number) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

function internalPortalErrorResponse(error: unknown): Response {
	if (error instanceof IngestionAuthenticationError) {
		return errorResponse("INGESTION_INTERNAL_TOKEN_INVALID", error.message, error.status);
	}
	if (error instanceof InternalPortalRequestError) {
		return errorResponse(error.code, error.message, error.status);
	}
	if (error instanceof InternalPortalCredentialStoreUnavailableError) {
		return errorResponse(
			"INGESTION_INTERNAL_PORTAL_STORE_UNAVAILABLE",
			"内部门户凭据数据库暂不可用。",
			503,
		);
	}
	if (error instanceof InternalPortalCredentialNotFoundError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_NOT_FOUND", error.message, 404);
	}
	if (error instanceof InternalPortalCredentialConflictError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_CONFLICT", error.message, 409);
	}
	if (error instanceof InternalPortalCredentialNameConflictError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_NAME_CONFLICT", error.message, 409);
	}
	if (error instanceof InternalPortalCandidateInputError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_INPUT_INVALID", error.message, 400);
	}
	if (error instanceof InternalPortalCandidateRejectedError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_CREDENTIAL_REJECTED", error.message, 422);
	}
	if (error instanceof InternalPortalCandidateCheckFailedError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_CHECK_FAILED", error.message, 503);
	}
	if (error instanceof InternalPortalCredentialResolutionUnavailableError) {
		return errorResponse("INGESTION_INTERNAL_PORTAL_CREDENTIAL_UNAVAILABLE", error.message, 503);
	}
	return errorResponse("INGESTION_INTERNAL_PORTAL_REQUEST_FAILED", "内部门户凭据请求失败。", 500);
}

function requireToken(request: Request, configured: string | null): void {
	if (!configured) {
		throw new IngestionAuthenticationError("内部访问 token 未配置。", 503);
	}
	const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/iu);
	const supplied = match?.[1]?.trim();
	if (!(supplied && constantTimeEqual(configured, supplied))) {
		throw new IngestionAuthenticationError("内部访问 token 无效。", 401);
	}
}

function constantTimeEqual(left: string, right: string): boolean {
	return timingSafeEqual(
		createHash("sha256").update(left).digest(),
		createHash("sha256").update(right).digest(),
	);
}

function requireExpectedVersion(request: Request): number {
	const match = /^"([1-9]\d*)"$/u.exec(request.headers.get("if-match")?.trim() ?? "");
	const version = match?.[1] ? Number(match[1]) : Number.NaN;
	if (!Number.isSafeInteger(version)) {
		throw new InternalPortalRequestError(
			"INGESTION_INTERNAL_PORTAL_PRECONDITION_REQUIRED",
			"请刷新内部门户凭据后再修改。",
			428,
		);
	}
	return version;
}

function invalidInput(): InternalPortalRequestError {
	return new InternalPortalRequestError(
		"INGESTION_INTERNAL_PORTAL_INPUT_INVALID",
		"内部门户凭据信息无效。",
		400,
	);
}

async function readJson(request: Request): Promise<unknown> {
	if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
		throw new InternalPortalRequestError(
			"INGESTION_INTERNAL_PORTAL_CONTENT_TYPE_REQUIRED",
			"Content-Type 必须是 application/json。",
			400,
		);
	}
	try {
		return await request.json();
	} catch {
		throw invalidInput();
	}
}

async function requireEmptyBody(request: Request): Promise<void> {
	if ((request.headers.get("content-length") ?? "").trim() === "0") {
		return;
	}
	if ((await request.clone().arrayBuffer()).byteLength > 0) {
		throw invalidInput();
	}
}

function credentialResponse(value: unknown, status = 200, version?: number): Response {
	const headers = noStoreHeaders();
	if (version !== undefined) {
		headers.set("etag", `"${version}"`);
	}
	return new Response(JSON.stringify(value), { headers, status });
}

function errorResponse(code: string, message: string, status: number): Response {
	return credentialResponse({ error: { code, message } }, status);
}

function noStoreHeaders(): Headers {
	return new Headers({
		"cache-control": "no-store",
		"content-type": "application/json",
	});
}

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}
