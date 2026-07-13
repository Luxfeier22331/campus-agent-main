import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchJson } from "../src/panel/http";

function createErrorResponse(payload: unknown, status = 403) {
	return new Response(JSON.stringify(payload), {
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
		status,
		statusText: "Forbidden",
	});
}

function createOpaqueRedirectResponse(url: string) {
	const response = new Response(null, {
		headers: {
			location: "https://mucwiki-edge.cloudflareaccess.com/cdn-cgi/access/login/example",
		},
		status: 302,
		statusText: "Found",
	});

	Object.defineProperties(response, {
		redirected: {
			value: false,
		},
		type: {
			value: "opaqueredirect",
		},
		url: {
			value: url,
		},
	});

	return response;
}

describe("Operator Console http copy", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("maps known runtime error codes to chinese operator-facing messages", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createErrorResponse({
				error: {
					code: "forbidden",
					message: "Operator access is not available for this principal.",
				},
			}),
		);

		await expect(fetchJson("/api/operator/provider-config/connections")).rejects.toMatchObject({
			message: "当前身份没有运维面板访问权限。",
			status: 403,
		});
	});

	it("maps internal errors to chinese operator-facing messages", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createErrorResponse(
				{
					error: {
						code: "internal_error",
						message: "Unexpected app-api failure.",
					},
				},
				500,
			),
		);

		await expect(fetchJson("/api/operator/provider-config/connections")).rejects.toMatchObject({
			message: "服务暂时不可用，请稍后重试。",
			status: 500,
		});
	});

	it("maps opaque access redirects to a login reentry error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createOpaqueRedirectResponse(
				"https://panel-staging.mucwiki-edge.link/api/operator/provider-config/connections",
			),
		);

		await expect(fetchJson("/api/operator/provider-config/connections")).rejects.toMatchObject({
			message: "当前受保护访问会话已失效，请重新进入面板。",
			redirectTo: "/login",
			status: 401,
		});
	});
});
