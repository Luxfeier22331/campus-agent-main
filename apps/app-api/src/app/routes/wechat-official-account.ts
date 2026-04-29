import type { Hono } from "hono";

import type { Env } from "../../config";
import { jsonResponse } from "../../http";
import {
	type ResolvedAppPrincipal,
	resolveWeChatOfficialAccountCollectorPrincipal,
} from "../../modules/auth";
import { requireOperatorPrincipal } from "../principal";
import { parseLimit, readJsonRequestBody } from "../request-utils";
import { serviceCredentialRequiredResponse } from "../responses";
import type { AppRequestScope } from "../types";

export function registerWeChatOfficialAccountRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	createRequestScope: () => AppRequestScope;
	env: Env;
	getPrincipal: (
		request: Request,
		env: Env,
		authInput: { getAppAuth: AppRequestScope["getAppAuth"] },
	) => Promise<ResolvedAppPrincipal | null>;
}) {
	input.app.post("/api/wechat-official-account/runs", async (c) => {
		const scope = input.createRequestScope();
		const principal = await resolveWeChatOfficialAccountCollectorPrincipal(c.req.raw, input.env);
		if (!principal) {
			return serviceCredentialRequiredResponse();
		}

		const response = await scope.resolveWeChatOfficialAccountCommandService().start({
			payload: await readJsonRequestBody(c.req.raw),
			principal,
		});

		return jsonResponse(response);
	});

	input.app.post("/api/wechat-official-account/runs/:runId/heartbeats", async (c) => {
		const scope = input.createRequestScope();
		const principal = await resolveWeChatOfficialAccountCollectorPrincipal(c.req.raw, input.env);
		if (!principal) {
			return serviceCredentialRequiredResponse();
		}

		const response = await scope.resolveWeChatOfficialAccountCommandService().heartbeat({
			payload: await readJsonRequestBody(c.req.raw),
			principal,
			runId: c.req.param("runId"),
		});

		return jsonResponse(response);
	});

	input.app.post("/api/wechat-official-account/runs/:runId/finalize", async (c) => {
		const scope = input.createRequestScope();
		const principal = await resolveWeChatOfficialAccountCollectorPrincipal(c.req.raw, input.env);
		if (!principal) {
			return serviceCredentialRequiredResponse();
		}

		const response = await scope.resolveWeChatOfficialAccountCommandService().finalize({
			payload: await readJsonRequestBody(c.req.raw),
			principal,
			runId: c.req.param("runId"),
		});

		return jsonResponse(response);
	});

	input.app.get("/api/operator/wechat-official-account/runs", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse(
			await scope.resolveWeChatOfficialAccountCommandService().listRuns({
				limit: parseLimit(c.req.query("limit")) ?? undefined,
			}),
		);
	});

	input.app.get("/api/operator/wechat-official-account/runs/:runId", async (c) => {
		const scope = input.createRequestScope();
		const resolved = await requireOperatorPrincipal({
			env: input.env,
			getPrincipal: input.getPrincipal,
			request: c.req.raw,
			scope,
		});
		if (resolved.response) {
			return resolved.response;
		}

		return jsonResponse({
			run: await scope.resolveWeChatOfficialAccountCommandService().getRun({
				runId: c.req.param("runId"),
			}),
		});
	});
}
