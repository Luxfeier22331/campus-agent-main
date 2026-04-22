import { describe, expect, it, vi } from "vitest";

import { APP_API_TEST_ENV, createApp } from "./auth-and-db-test-support";

export function registerApiMeSuite() {
	describe("/api/me", () => {
		it("returns session_required when no app principal exists", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(null),
			});

			const response = await app.fetch(new Request("https://app-api.internal/api/me"));

			expect(response.status).toBe(401);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "session_required",
					message: "Sign in required.",
					retryable: false,
					traceId: null,
					requestId: null,
					details: null,
				},
			});
		});

		it("mounts /api/auth/* onto the auth handler seam", async () => {
			const authHandler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
			const app = createApp(APP_API_TEST_ENV, {
				authHandler,
				getPrincipal: vi.fn().mockResolvedValue(null),
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/auth/get-session", {
					headers: {
						cookie: "better-auth.session_token=test",
					},
				}),
			);

			expect(authHandler).toHaveBeenCalledTimes(1);
			expect(authHandler).toHaveBeenCalledWith(
				expect.any(Request),
				APP_API_TEST_ENV,
				expect.objectContaining({
					getAppAuth: expect.any(Function),
				}),
			);
			expect(response.status).toBe(204);
		});

		it("returns the current campus member principal and session", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue({
					permissions: {
						chat: true,
						operator: false,
					},
					principal: {
						displayName: "Jane Doe",
						email: "jane@muc.edu.cn",
						principalId: "user_01HQ",
						type: "campus_member",
					},
					session: {
						expiresAt: "2026-03-29T07:00:00.000Z",
						sessionId: "sess_01HQ",
					},
				}),
			});

			const response = await app.fetch(new Request("https://app-api.internal/api/me"));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				permissions: {
					chat: true,
					operator: false,
				},
				principal: {
					displayName: "Jane Doe",
					email: "jane@muc.edu.cn",
					principalId: "user_01HQ",
					type: "campus_member",
				},
				session: {
					expiresAt: "2026-03-29T07:00:00.000Z",
					sessionId: "sess_01HQ",
				},
			});
		});

		it("returns a trusted operator principal without creating a user session", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue({
					permissions: {
						chat: false,
						operator: true,
					},
					principal: {
						displayName: "Ops Team",
						email: "ops@example.com",
						principalId: "ops@example.com",
						type: "operator",
					},
					session: null,
				}),
			});

			const response = await app.fetch(new Request("https://app-api.internal/api/me"));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				permissions: {
					chat: false,
					operator: true,
				},
				principal: {
					displayName: "Ops Team",
					email: "ops@example.com",
					principalId: "ops@example.com",
					type: "operator",
				},
				session: null,
			});
		});
	});
}
