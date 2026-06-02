import { describe, expect, it, vi } from "vitest";

import { buildIdentityPlatformService } from "../src/modules/identity-platform";
import { APP_API_TEST_ENV, createApp } from "./auth-and-db-test-support";

function createCampusPrincipal() {
	return {
		actor: {
			cohort: "2026",
			departments: ["computer_science"],
			major: "software_engineering",
			principalId: "user_01HQ",
			principalType: "student" as const,
			program: "undergraduate",
			roles: ["campus_member", "student"],
			userId: "user_01HQ",
		},
		authorization: {
			approvalState: "",
			entitlementGroups: ["campus_members", "students", "library_readers"],
			entitlementSnapshotId: "ent_01HQ",
			ownershipScopes: [],
			principalId: "user_01HQ",
			projectionSource: "campus_identity" as const,
			retrievalFilter: {
				entitlementGroups: ["campus_members", "students", "library_readers"],
				policyProjectionVersion: "policy-v2",
				visibilityLevel: "restricted",
				visibilityScope: "student",
			},
			visibilityScope: "student",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@muc.edu.cn",
			principalId: "user_01HQ",
			type: "student" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

function createIdentityStoreStub() {
	return {
		updatePreferencesAndMaterialize: vi.fn(),
	};
}

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

	describe("/api/me/overview", () => {
		it("returns session_required when no app principal exists", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(null),
			});

			const response = await app.fetch(new Request("https://app-api.internal/api/me/overview"));

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

		it("returns the account center product projection for an end-user principal", async () => {
			const profileMemoryService = {
				deleteItem: vi.fn(),
				list: vi.fn(),
				setEnabled: vi.fn(),
				upsert: vi.fn(),
			};
			const profileMemoryStore = {
				loadSummary: vi.fn().mockResolvedValue({
					enabled: true,
					itemCount: 2,
				}),
			};
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				identityPlatformService: buildIdentityPlatformService({
					identityStore: createIdentityStoreStub(),
					profileMemoryStore,
				}),
				profileMemoryService,
			} as Parameters<typeof createApp>[1]);

			const response = await app.fetch(new Request("https://app-api.internal/api/me/overview"));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				account: {
					accountId: "user_01HQ",
					displayName: "Jane Doe",
					email: "jane@muc.edu.cn",
					status: "active",
				},
				session: {
					credentialRuntime: "better_auth",
					expiresAt: "2026-03-29T07:00:00.000Z",
					sessionId: "sess_01HQ",
					state: "authenticated",
				},
				identity: {
					campusAttributes: {
						cohort: "2026",
						departments: ["computer_science"],
						major: "software_engineering",
						program: "undergraduate",
					},
					claimsVersion: "policy-v2",
					principalId: "user_01HQ",
					principalType: "student",
					verificationStatus: "unverified",
				},
				access: {
					availableApps: ["chat", "docs", "account"],
					entitlementGroups: ["campus_members", "students", "library_readers"],
					permissions: {
						chat: true,
						operator: false,
					},
					restrictedSurfacesReady: true,
				},
				preferences: {
					profileMemoryEnabled: true,
					profileMemoryItemCount: 2,
				},
				federation: {
					connectedClients: [],
					enabled: false,
				},
			});
			expect(profileMemoryService.list).not.toHaveBeenCalled();
			expect(profileMemoryStore.loadSummary).toHaveBeenCalledWith({
				ownerUserId: "user_01HQ",
			});
		});

		it("does not require chat permission to load the account overview", async () => {
			const profileMemoryStore = {
				loadSummary: vi.fn().mockResolvedValue({
					enabled: false,
					itemCount: 0,
				}),
			};
			const principal = createCampusPrincipal();
			principal.permissions.chat = false;
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				identityPlatformService: buildIdentityPlatformService({
					identityStore: createIdentityStoreStub(),
					profileMemoryStore,
				}),
			} as Parameters<typeof createApp>[1]);

			const response = await app.fetch(new Request("https://app-api.internal/api/me/overview"));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				access: {
					availableApps: ["docs", "account"],
					permissions: {
						chat: false,
						operator: false,
					},
				},
				preferences: {
					profileMemoryEnabled: false,
					profileMemoryItemCount: 0,
				},
			});
			expect(profileMemoryStore.loadSummary).toHaveBeenCalledWith({
				ownerUserId: "user_01HQ",
			});
		});

		it("rejects operator principals from the end-user account overview", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue({
					actor: {
						departments: [],
						principalId: "ops@example.com",
						principalType: "operator",
						roles: ["operator"],
						userId: "ops@example.com",
					},
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

			const response = await app.fetch(new Request("https://app-api.internal/api/me/overview"));

			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toMatchObject({
				error: {
					code: "forbidden",
				},
			});
		});
	});

	describe("/api/me/preferences", () => {
		it("returns the account-center preferences projection for an end-user principal", async () => {
			const profileMemoryStore = {
				loadSummary: vi.fn().mockResolvedValue({
					enabled: false,
					itemCount: 3,
				}),
			};
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				identityPlatformService: buildIdentityPlatformService({
					identityStore: createIdentityStoreStub(),
					profileMemoryStore,
				}),
			} as Parameters<typeof createApp>[1]);

			const response = await app.fetch(new Request("https://app-api.internal/api/me/preferences"));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				preferences: {
					profileMemoryEnabled: false,
					profileMemoryItemCount: 3,
				},
			});
		});

		it("updates preferences and materializes the identity product snapshot", async () => {
			const updatePreferencesAndMaterialize = vi.fn().mockResolvedValue(undefined);
			const profileMemoryStore = {
				loadSummary: vi.fn().mockResolvedValue({
					enabled: true,
					itemCount: 2,
				}),
			};
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				identityPlatformService: buildIdentityPlatformService({
					generateId: (prefix) => `${prefix}_01HQ`,
					identityStore: {
						updatePreferencesAndMaterialize,
					},
					now: () => new Date("2026-03-29T08:00:00.000Z"),
					profileMemoryStore,
				}),
			} as Parameters<typeof createApp>[1]);

			const response = await app.fetch(
				new Request("https://app-api.internal/api/me/preferences", {
					body: JSON.stringify({ profileMemoryEnabled: false }),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				}),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				preferences: {
					profileMemoryEnabled: false,
					profileMemoryItemCount: 2,
				},
			});
			expect(updatePreferencesAndMaterialize).toHaveBeenCalledWith(
				expect.objectContaining({
					observedAt: "2026-03-29T08:00:00.000Z",
					overview: expect.objectContaining({
						account: expect.objectContaining({
							accountId: "user_01HQ",
							email: "jane@muc.edu.cn",
						}),
						preferences: {
							profileMemoryEnabled: false,
							profileMemoryItemCount: 2,
						},
					}),
					snapshotId: "access_snapshot_01HQ",
				}),
			);
		});

		it("rejects operator principals from account-center preferences", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue({
					actor: {
						departments: [],
						principalId: "ops@example.com",
						principalType: "operator",
						roles: ["operator"],
						userId: "ops@example.com",
					},
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
					session: {
						expiresAt: "2026-03-29T07:00:00.000Z",
						sessionId: "sess_ops",
					},
				}),
			});

			const response = await app.fetch(new Request("https://app-api.internal/api/me/preferences"));

			expect(response.status).toBe(403);
		});

		it("rejects invalid preference update payloads", async () => {
			const app = createApp(APP_API_TEST_ENV, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				identityPlatformService: buildIdentityPlatformService({
					identityStore: createIdentityStoreStub(),
					profileMemoryStore: {
						loadSummary: vi.fn().mockResolvedValue({
							enabled: true,
							itemCount: 0,
						}),
					},
				}),
			} as Parameters<typeof createApp>[1]);

			const response = await app.fetch(
				new Request("https://app-api.internal/api/me/preferences", {
					body: JSON.stringify({ profileMemoryEnabled: "false" }),
					headers: { "content-type": "application/json" },
					method: "PATCH",
				}),
			);

			expect(response.status).toBe(400);
		});
	});
}
