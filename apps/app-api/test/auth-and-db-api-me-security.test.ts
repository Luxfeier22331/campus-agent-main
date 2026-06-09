import { describe, expect, it, vi } from "vitest";

import type { IdentityPlatformService } from "../src/modules/identity-platform";
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

function createIdentityPlatformServiceStub(
	overrides: Partial<IdentityPlatformService> = {},
): IdentityPlatformService {
	return {
		deleteAuthorizedApp: vi.fn().mockResolvedValue(undefined),
		deleteSecuritySession: vi.fn().mockResolvedValue(undefined),
		getAccess: vi.fn(),
		getAuthorizedApps: vi.fn().mockResolvedValue({ authorizedApps: [] }),
		getIdentity: vi.fn(),
		getOverview: vi.fn(),
		getPreferences: vi.fn(),
		getSecuritySessions: vi.fn().mockResolvedValue({ sessions: [] }),
		materializeSessionProjection: vi.fn(),
		updatePreferences: vi.fn(),
		...overrides,
	};
}

describe("/api/me/security/sessions", () => {
	it("returns session_required when no app principal exists", async () => {
		const app = createApp(APP_API_TEST_ENV, {
			getPrincipal: vi.fn().mockResolvedValue(null),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/security/sessions"),
		);

		expect(response.status).toBe(401);
	});

	it("rejects operator principals from account security sessions", async () => {
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

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/security/sessions"),
		);

		expect(response.status).toBe(403);
	});

	it("returns account security sessions without token material", async () => {
		const getSecuritySessions = vi.fn().mockResolvedValue({
			sessions: [
				{
					createdAt: "2026-03-29T06:00:00.000Z",
					current: true,
					deviceLabel: "当前浏览器",
					expiresAt: "2026-03-29T07:00:00.000Z",
					lastActiveAt: "2026-03-29T06:30:00.000Z",
					sessionId: "sess_01HQ",
				},
				{
					createdAt: "2026-03-28T06:00:00.000Z",
					current: false,
					deviceLabel: "其他浏览器",
					expiresAt: "2026-03-30T07:00:00.000Z",
					lastActiveAt: "2026-03-28T06:30:00.000Z",
					sessionId: "sess_other",
				},
			],
		});
		const app = createApp(APP_API_TEST_ENV, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			identityPlatformService: createIdentityPlatformServiceStub({ getSecuritySessions }),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/security/sessions"),
		);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload).toEqual({
			sessions: [
				{
					createdAt: "2026-03-29T06:00:00.000Z",
					current: true,
					deviceLabel: "当前浏览器",
					expiresAt: "2026-03-29T07:00:00.000Z",
					lastActiveAt: "2026-03-29T06:30:00.000Z",
					sessionId: "sess_01HQ",
				},
				{
					createdAt: "2026-03-28T06:00:00.000Z",
					current: false,
					deviceLabel: "其他浏览器",
					expiresAt: "2026-03-30T07:00:00.000Z",
					lastActiveAt: "2026-03-28T06:30:00.000Z",
					sessionId: "sess_other",
				},
			],
		});
		expect(JSON.stringify(payload)).not.toContain("token");
		expect(getSecuritySessions).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
		});
	});

	it("revokes an owned security session", async () => {
		const deleteSecuritySession = vi.fn().mockResolvedValue(undefined);
		const app = createApp(APP_API_TEST_ENV, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			identityPlatformService: createIdentityPlatformServiceStub({ deleteSecuritySession }),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/security/sessions/sess_other", {
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(204);
		expect(deleteSecuritySession).toHaveBeenCalledWith({
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
			sessionId: "sess_other",
		});
	});
});

describe("/api/me/authorized-apps", () => {
	it("returns authorized applications without protocol token material", async () => {
		const getAuthorizedApps = vi.fn().mockResolvedValue({
			authorizedApps: [
				{
					authorizedAt: "2026-03-29T06:00:00.000Z",
					clientId: "muc-wiki",
					displayName: "MUC Wiki",
					grantedScopes: ["openid", "profile"],
					homeUrl: "https://muc.wiki",
					lastUsedAt: "2026-03-29T06:30:00.000Z",
					status: "active",
				},
			],
		});
		const app = createApp(APP_API_TEST_ENV, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			identityPlatformService: createIdentityPlatformServiceStub({ getAuthorizedApps }),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/authorized-apps"),
		);

		expect(response.status).toBe(200);
		const payload = await response.json();
		expect(payload).toEqual({
			authorizedApps: [
				{
					authorizedAt: "2026-03-29T06:00:00.000Z",
					clientId: "muc-wiki",
					displayName: "MUC Wiki",
					grantedScopes: ["openid", "profile"],
					homeUrl: "https://muc.wiki",
					lastUsedAt: "2026-03-29T06:30:00.000Z",
					status: "active",
				},
			],
		});
		expect(JSON.stringify(payload)).not.toContain("accessToken");
		expect(JSON.stringify(payload)).not.toContain("refreshToken");
		expect(JSON.stringify(payload)).not.toContain("clientSecret");
	});

	it("rejects service principals from authorized applications", async () => {
		const app = createApp(APP_API_TEST_ENV, {
			getPrincipal: vi.fn().mockResolvedValue({
				actor: {
					departments: [],
					principalId: "service:collector",
					principalType: "service",
					roles: ["service"],
					userId: "service:collector",
				},
				permissions: {
					chat: false,
					operator: false,
				},
				principal: {
					displayName: "Collector",
					email: null,
					principalId: "service:collector",
					type: "service",
				},
				session: null,
			}),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/authorized-apps"),
		);

		expect(response.status).toBe(403);
	});

	it("revokes an authorized application for the current account", async () => {
		const deleteAuthorizedApp = vi.fn().mockResolvedValue(undefined);
		const app = createApp(APP_API_TEST_ENV, {
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			identityPlatformService: createIdentityPlatformServiceStub({ deleteAuthorizedApp }),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/me/authorized-apps/muc-wiki", {
				method: "DELETE",
			}),
		);

		expect(response.status).toBe(204);
		expect(deleteAuthorizedApp).toHaveBeenCalledWith({
			clientId: "muc-wiki",
			principal: expect.objectContaining({
				principal: expect.objectContaining({ principalId: "user_01HQ" }),
			}),
		});
	});
});
