import type { DiningMySubmissionResponse } from "@campus-agent/dining/domain";
import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse, routeErrorResponse, withNoStore } from "../../http";
import type { DiningSubmissionPhotoResult } from "../../modules/dining/submission-service-contract";
import {
	principalResolutionErrorResponse,
	requireSessionPrincipal,
	resolvePrincipalForScope,
} from "../principal";
import type { AppDependencies, AppRequestScope } from "../types";
import {
	readSubmissionCreate,
	readSubmissionUpdate,
	submissionIdempotencyKey,
	submissionPagination,
	submissionPathId,
	submissionRevision,
	submissionWindowId,
} from "./dining-submission-request";

export function registerDiningSubmissionRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: NonNullable<AppDependencies["getPrincipal"]>;
}) {
	const session = (request: Request, scope: AppRequestScope) =>
		requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request,
			scope,
		});
	const viewer = async (request: Request, scope: AppRequestScope) => {
		try {
			return await resolvePrincipalForScope({
				env: input.env,
				getPrincipal: input.getPrincipal,
				request,
				scope,
			});
		} catch (error) {
			return principalResolutionErrorResponse(error);
		}
	};

	input.app.get("/api/dining/windows/:windowId/submissions", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const principal = await viewer(c.req.raw, scope);
			if (principal instanceof Response) {
				return principal;
			}
			return jsonResponse(
				await scope.resolveDiningSubmissionService().listPublic({
					...submissionPagination(c.req.raw),
					windowId: submissionWindowId(c.req.param("windowId")),
					viewerUserId: principal?.principal.principalId ?? null,
				}),
			);
		}),
	);

	input.app.post("/api/dining/windows/:windowId/submissions", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const resolved = await session(c.req.raw, scope);
			if (resolved.response) {
				return resolved.response;
			}
			const windowId = submissionWindowId(c.req.param("windowId"));
			const idempotencyKey = submissionIdempotencyKey(c.req.raw);
			const body = await readSubmissionCreate(c.req.raw);
			return ownResponse(
				await scope.resolveDiningSubmissionService().create({
					...body,
					windowId,
					idempotencyKey,
					actor: {
						displayName: resolved.principal.principal.displayName,
						principalId: resolved.principal.principal.principalId,
					},
				}),
				201,
			);
		}),
	);

	input.app.get("/api/dining/submissions/:submissionId", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const principal = await viewer(c.req.raw, scope);
			if (principal instanceof Response) {
				return principal;
			}
			return jsonResponse(
				await scope.resolveDiningSubmissionService().getPublic({
					submissionId: submissionPathId(c.req.param("submissionId")),
					viewerUserId: principal?.principal.principalId ?? null,
				}),
			);
		}),
	);

	input.app.get("/api/dining/submissions/:submissionId/photos/:photoId", async (c) =>
		respondPhoto(async () =>
			photoResponse(
				await input
					.createRequestScope()
					.resolveDiningSubmissionService()
					.getPhoto({
						submissionId: submissionPathId(c.req.param("submissionId")),
						photoId: submissionPathId(c.req.param("photoId")),
						ownerUserId: null,
						ifNoneMatch: c.req.raw.headers.get("if-none-match"),
					}),
			),
		),
	);

	input.app.get("/api/dining/me/submissions", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const resolved = await session(c.req.raw, scope);
			if (resolved.response) {
				return resolved.response;
			}
			return jsonResponse(
				await scope.resolveDiningSubmissionService().listOwn({
					...submissionPagination(c.req.raw),
					userId: resolved.principal.principal.principalId,
				}),
			);
		}),
	);

	input.app.get("/api/dining/me/submissions/:submissionId", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const resolved = await session(c.req.raw, scope);
			if (resolved.response) {
				return resolved.response;
			}
			return ownResponse(
				await scope.resolveDiningSubmissionService().getOwn({
					submissionId: submissionPathId(c.req.param("submissionId")),
					userId: resolved.principal.principal.principalId,
				}),
			);
		}),
	);

	input.app.get("/api/dining/me/submissions/:submissionId/photos/:photoId", async (c) =>
		respondPhoto(async () => {
			const scope = input.createRequestScope();
			const resolved = await session(c.req.raw, scope);
			if (resolved.response) {
				return resolved.response;
			}
			return photoResponse(
				await scope.resolveDiningSubmissionService().getPhoto({
					submissionId: submissionPathId(c.req.param("submissionId")),
					photoId: submissionPathId(c.req.param("photoId")),
					ownerUserId: resolved.principal.principal.principalId,
					ifNoneMatch: c.req.raw.headers.get("if-none-match"),
				}),
			);
		}),
	);

	input.app.patch("/api/dining/me/submissions/:submissionId", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const resolved = await session(c.req.raw, scope);
			if (resolved.response) {
				return resolved.response;
			}
			const submissionId = submissionPathId(c.req.param("submissionId"));
			const expectedRevision = submissionRevision(c.req.raw);
			const body = await readSubmissionUpdate(c.req.raw);
			return ownResponse(
				await scope.resolveDiningSubmissionService().update({
					...body,
					submissionId,
					expectedRevision,
					actor: {
						displayName: resolved.principal.principal.displayName,
						principalId: resolved.principal.principal.principalId,
					},
				}),
			);
		}),
	);

	input.app.delete("/api/dining/me/submissions/:submissionId", async (c) =>
		respond(async () => {
			const scope = input.createRequestScope();
			const resolved = await session(c.req.raw, scope);
			if (resolved.response) {
				return resolved.response;
			}
			await scope.resolveDiningSubmissionService().deleteOwn({
				submissionId: submissionPathId(c.req.param("submissionId")),
				expectedRevision: submissionRevision(c.req.raw),
				userId: resolved.principal.principal.principalId,
			});
			return new Response(null, { status: 204 });
		}),
	);
}

async function respond(action: () => Promise<Response>): Promise<Response> {
	try {
		return withNoStore(await action());
	} catch (error) {
		if (error instanceof AppApiRouteError) {
			return routeErrorResponse(error);
		}
		throw error;
	}
}

// Photo successes keep a revalidation cache policy instead of the no-store
// wrapper; errors fall back to the same no-store error envelope as respond().
async function respondPhoto(action: () => Promise<Response>): Promise<Response> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof AppApiRouteError) {
			return routeErrorResponse(error);
		}
		throw error;
	}
}

function ownResponse(result: DiningMySubmissionResponse, status = 200): Response {
	return jsonResponse(result, { status, headers: { etag: `"${result.submission.revision}"` } });
}

function photoResponse(result: DiningSubmissionPhotoResult): Response {
	if (result.notModified) {
		return new Response(null, {
			headers: {
				"cache-control": "private, no-cache",
				etag: result.etag,
			},
			status: 304,
		});
	}
	return new Response(new Uint8Array(result.bytes), {
		headers: {
			"cache-control": "private, no-cache",
			"content-type": "image/webp",
			etag: result.etag,
			"x-content-type-options": "nosniff",
		},
	});
}
