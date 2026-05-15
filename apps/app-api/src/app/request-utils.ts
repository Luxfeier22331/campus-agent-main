import { parseCsvList } from "../config";
import { AppApiRouteError } from "../http";
import { buildInternalEvalPrincipal, type ResolvedAppPrincipal } from "../modules/auth";

export function buildInternalEvalPrincipalFromRequest(request: Request): ResolvedAppPrincipal {
	return buildInternalEvalPrincipal({
		actorRoles: parseCsvList(request.headers.get("x-eval-actor-roles") ?? undefined),
		applicabilityScope: request.headers.get("x-eval-applicability-scope") ?? undefined,
		cohort: request.headers.get("x-eval-cohort") ?? undefined,
		departments: parseCsvList(request.headers.get("x-eval-departments") ?? undefined),
		displayName: request.headers.get("x-eval-user-name") ?? undefined,
		email: request.headers.get("x-eval-user-email") ?? "",
		major: request.headers.get("x-eval-major") ?? undefined,
		entitlementGroups: parseCsvList(request.headers.get("x-eval-entitlement-groups") ?? undefined),
		entitlementSnapshotId: request.headers.get("x-eval-entitlement-snapshot-id") ?? undefined,
		ownershipScopes: parseCsvList(request.headers.get("x-eval-ownership-scopes") ?? undefined),
		principalId: request.headers.get("x-eval-user-id") ?? undefined,
		principalType:
			(request.headers.get("x-eval-principal-type") as
				| "campus_member"
				| "student"
				| "staff"
				| "faculty"
				| null) ?? undefined,
		program: request.headers.get("x-eval-program") ?? undefined,
		visibilityLevel: request.headers.get("x-eval-visibility-level") ?? undefined,
		visibilityScope: request.headers.get("x-eval-visibility-scope"),
	});
}

export function parseLimit(value: string | null | undefined): number | null {
	if (!value) {
		return null;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

export function readOperatorAggregateFilters(request: { query(name: string): string | undefined }) {
	return {
		collection: request.query("collection") ?? null,
		granularity: request.query("granularity") ?? null,
		modelName: request.query("modelName") ?? null,
		principalType: request.query("principalType") ?? null,
		requestedCapability: request.query("requestedCapability") ?? null,
		selectedTarget: request.query("selectedTarget") ?? null,
		surface: request.query("surface") ?? null,
		window: request.query("window") ?? null,
	};
}

export function resolveRequestSurface(request: Request): string {
	const pathname = new URL(request.url).pathname;

	if (pathname.startsWith("/api/operator/")) {
		return "protected_panel_web";
	}
	if (pathname.startsWith("/api/internal/official-web/")) {
		return "official_web";
	}
	if (pathname.startsWith("/api/official-web/")) {
		return "official_web";
	}
	if (pathname.startsWith("/api/wechat-official-account/")) {
		return "wechat_official_account";
	}
	if (
		pathname === "/api/chat" ||
		pathname === "/api/history" ||
		pathname.startsWith("/api/chat/") ||
		pathname.startsWith("/api/auth/") ||
		pathname === "/api/me"
	) {
		return "public_chat_web";
	}

	return "app_api";
}

export function createRouteErrorCorrelation() {
	return {
		requestId: `req_${crypto.randomUUID().replace(/-/g, "")}`,
		traceId: `trace_${crypto.randomUUID().replace(/-/g, "")}`,
	};
}

export async function readJsonRequestBody(request: Request): Promise<Record<string, unknown>> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.toLowerCase().includes("application/json")) {
		throw new AppApiRouteError({
			code: "unsupported_media_type",
			message: "application/json is required.",
			retryable: false,
			status: 415,
		});
	}

	const payload = (await request.json().catch(() => {
		throw new AppApiRouteError({
			code: "invalid_json",
			message: "Invalid JSON body.",
			retryable: false,
			status: 400,
		});
	})) as unknown;

	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new AppApiRouteError({
			code: "invalid_json_body",
			message: "JSON body must be an object.",
			retryable: false,
			status: 400,
		});
	}

	return payload as Record<string, unknown>;
}

export function resolveWaitUntil(
	context: { executionCtx?: { waitUntil(promise: Promise<unknown>): void } } | null | undefined,
): ((promise: Promise<unknown>) => void) | undefined {
	try {
		return context?.executionCtx?.waitUntil.bind(context.executionCtx);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "This context has no ExecutionContext"
		) {
			return;
		}
		throw error;
	}
}
