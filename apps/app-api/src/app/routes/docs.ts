import type { Hono } from "hono";

import type { Env } from "../../config";
import { errorEnvelope, jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { assertDocsReleaseId, DOCS_RELEASE_HEADER } from "../../modules/docs";
import { principalResolutionErrorResponse, resolvePrincipalForScope } from "../principal";
import type { AppDocsReadinessResult, AppRequestScope } from "../types";

export function registerDocsRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	docsReadinessProbe: (releaseId: string) => Promise<AppDocsReadinessResult>;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/docs/readyz", async (c) => {
		const readiness = await input.docsReadinessProbe(requireDocsRelease(c.req.raw));
		if (Object.keys(readiness.failed).length > 0) {
			return jsonResponse(
				errorEnvelope({
					code: "dependency_not_ready",
					message: "Document reader control plane is not ready.",
					retryable: true,
					details: {
						failed: readiness.failed,
					},
				}),
				{ status: 503 },
			);
		}

		return jsonResponse({
			status: "ready",
			dependencies: readiness.dependencies,
		});
	});

	input.app.get("/api/docs/collections/:corpus/:collection/navigation", async (c) => {
		const releaseId = requireDocsRelease(c.req.raw);
		const scope = input.createRequestScope();
		const resolved = await resolveOptionalPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveDocsService().getNavigation({
				collection: c.req.param("collection"),
				corpus: c.req.param("corpus"),
				principal: resolved.principal,
				releaseId,
			}),
		);
	});

	input.app.get("/api/docs/collections/:corpus/:collection/documents/:documentSlug", async (c) => {
		const releaseId = requireDocsRelease(c.req.raw);
		const scope = input.createRequestScope();
		const resolved = await resolveOptionalPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveDocsService().getDocumentSummary({
				collection: c.req.param("collection"),
				corpus: c.req.param("corpus"),
				documentSlug: c.req.param("documentSlug"),
				principal: resolved.principal,
				releaseId,
			}),
		);
	});

	input.app.get(
		"/api/docs/collections/:corpus/:collection/documents/:documentSlug/versions",
		async (c) => {
			const releaseId = requireDocsRelease(c.req.raw);
			const scope = input.createRequestScope();
			const resolved = await resolveOptionalPrincipal({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			if (resolved.response) {
				return resolved.response;
			}

			return jsonResponse(
				await scope.resolveDocsService().getVersions({
					collection: c.req.param("collection"),
					corpus: c.req.param("corpus"),
					documentSlug: c.req.param("documentSlug"),
					principal: resolved.principal,
					releaseId,
				}),
			);
		},
	);

	input.app.get(
		"/api/docs/collections/:corpus/:collection/documents/:documentSlug/resolve",
		async (c) => {
			const releaseId = requireDocsRelease(c.req.raw);
			const scope = input.createRequestScope();
			const resolved = await resolveOptionalPrincipal({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			if (resolved.response) {
				return resolved.response;
			}

			return jsonResponse(
				await scope.resolveDocsService().resolveReader({
					anchor: normalizeOptionalString(c.req.query("anchor")),
					collection: c.req.param("collection"),
					corpus: c.req.param("corpus"),
					documentSlug: c.req.param("documentSlug"),
					highlightRootUnitIds: parseHighlightRootUnitIds(c.req.query("hl")),
					principal: resolved.principal,
					releaseId,
					version: normalizeOptionalString(c.req.query("version")),
				}),
			);
		},
	);

	input.app.get(
		"/api/docs/collections/:corpus/:collection/documents/:documentSlug/admission",
		async (c) => {
			const releaseId = requireDocsRelease(c.req.raw);
			const scope = input.createRequestScope();
			const resolved = await resolveOptionalPrincipal({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: c.req.raw,
				scope,
			});
			if (resolved.response) {
				return resolved.response;
			}

			await scope.resolveDocsService().checkReaderAdmission({
				collection: c.req.param("collection"),
				corpus: c.req.param("corpus"),
				documentSlug: c.req.param("documentSlug"),
				principal: resolved.principal,
				releaseId,
				version: normalizeOptionalString(c.req.query("version")),
			});

			return new Response(null, {
				headers: {
					"cache-control": "no-store",
					vary: "Cookie, Authorization",
				},
				status: 204,
			});
		},
	);
}

function requireDocsRelease(request: Request): string {
	return assertDocsReleaseId(request.headers.get(DOCS_RELEASE_HEADER));
}

async function resolveOptionalPrincipal(input: {
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
	request: Request;
	scope: AppRequestScope;
}): Promise<
	| { principal: ResolvedAppPrincipal | null; response?: never }
	| { principal?: never; response: Response }
> {
	try {
		return {
			principal: await resolvePrincipalForScope({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request: input.request,
				scope: input.scope,
			}),
		};
	} catch (error) {
		return { response: principalResolutionErrorResponse(error) };
	}
}

function normalizeOptionalString(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

function parseHighlightRootUnitIds(value: string | null | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}
