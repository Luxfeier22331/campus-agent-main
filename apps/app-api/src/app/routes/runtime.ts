import type { Hono } from "hono";

import { type Env, getMissingRuntimeConfig, resolveAppName } from "../../config";
import { errorEnvelope, jsonResponse } from "../../http";
import type { AppRuntimeReadinessResult } from "../types";

export function registerRuntimeRoutes(input: {
	app: Hono<{ Bindings: Env }>;
	env: Env;
	runtimeReadinessProbe: () => Promise<AppRuntimeReadinessResult>;
}) {
	input.app.get("/healthz", (c) =>
		jsonResponse({
			status: "ok",
			app: resolveAppName(input.env),
		}),
	);

	input.app.get("/readyz", async () => {
		const missing = getMissingRuntimeConfig(input.env);
		if (missing.length > 0) {
			return jsonResponse(
				errorEnvelope({
					code: "dependency_not_ready",
					message: "Runtime configuration is incomplete.",
					retryable: true,
					details: { missing },
				}),
				{ status: 503 },
			);
		}

		const readiness = await input.runtimeReadinessProbe();
		if (Object.keys(readiness.failed).length > 0) {
			return jsonResponse(
				errorEnvelope({
					code: "dependency_not_ready",
					message: "Runtime dependencies are not ready.",
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
}
