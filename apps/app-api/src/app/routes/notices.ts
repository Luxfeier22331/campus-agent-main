import { NoticeIdSchema, NoticeListRequestQuerySchema } from "campus-contracts/notices";
import type { Hono } from "hono";

import type { Env } from "../../config";
import { AppApiRouteError, jsonResponse } from "../../http";
import type { ResolvedAppPrincipal } from "../../modules/auth";
import { requireSessionPrincipal } from "../principal";
import type { AppRequestScope } from "../types";

export function registerNoticeRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.get("/api/notices", async (c) => {
		const scope = input.createRequestScope();
		const auth = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (auth.response) {
			return auth.response;
		}
		const query = NoticeListRequestQuerySchema.safeParse(c.req.query());
		if (!query.success) {
			throw invalidNoticeRequest();
		}
		return jsonResponse(await scope.resolveNoticeService().list(query.data));
	});

	input.app.get("/api/notices/:noticeId", async (c) => {
		const scope = input.createRequestScope();
		const auth = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (auth.response) {
			return auth.response;
		}
		const noticeId = NoticeIdSchema.safeParse(c.req.param("noticeId"));
		if (!noticeId.success) {
			throw invalidNoticeRequest();
		}
		return jsonResponse(await scope.resolveNoticeService().getDetail(noticeId.data));
	});

	input.app.get("/api/notices/:noticeId/images/:ordinal", async (c) => {
		const scope = input.createRequestScope();
		const auth = await requireSessionPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (auth.response) {
			return auth.response;
		}
		const noticeId = NoticeIdSchema.safeParse(c.req.param("noticeId"));
		const ordinal = parseOrdinal(c.req.param("ordinal"));
		if (!(noticeId.success && ordinal !== null)) {
			throw invalidNoticeRequest();
		}
		const image = await scope.resolveNoticeService().readImage(noticeId.data, ordinal);
		return new Response(image.body, {
			headers: {
				"cache-control": "no-store",
				"content-security-policy": "default-src 'none'; sandbox",
				"content-type": image.contentType,
				"x-content-type-options": "nosniff",
			},
		});
	});
}

function parseOrdinal(value: string | undefined): number | null {
	if (!(value && /^(0|[1-9][0-9]{0,8})$/u.test(value))) {
		return null;
	}
	return Number(value);
}

function invalidNoticeRequest(): AppApiRouteError {
	return new AppApiRouteError({
		code: "validation_failed",
		message: "Notice request parameters are invalid.",
		retryable: false,
		status: 400,
	});
}
