// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/auth/auth", () => ({
	getAppAuth: vi.fn(),
}));

import type { AppApiRouteError } from "../src/http";
import { getAppAuth } from "../src/modules/auth/auth";
import {
	mapOperatorHeadersToPrincipal,
	mapSessionToAppPrincipal,
	mapSessionToCampusMemberPrincipal,
	resolveOfficialWebCollectorPrincipal,
	resolveRequestPrincipal,
} from "../src/modules/auth/principal";

const mockedGetAppAuth = vi.mocked(getAppAuth);

describe("operator bridge principal resolution", () => {
	it("does not trust operator headers without a matching internal shared secret", () => {
		const request = new Request("https://app-api.internal/api/operator/requests", {
			headers: {
				"x-app-operator-email": "ops@example.com",
				"x-app-operator-groups": "panel,ops",
			},
		});

		expect(
			mapOperatorHeadersToPrincipal(request, {
				APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
				APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			}),
		).toBeNull();
	});

	it("resolves an operator principal only when allowlist and internal auth both match", () => {
		const request = new Request("https://app-api.internal/api/operator/requests", {
			headers: {
				"x-app-internal-auth": "trusted-secret",
				"x-app-operator-email": "ops@example.com",
				"x-app-operator-groups": "panel,ops",
				"x-app-operator-campus-scope": "main",
				"x-app-operator-id": "operator-001",
				"x-app-operator-name": "Ops Team",
			},
		});

		const principal = mapOperatorHeadersToPrincipal(request, {
			APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
			APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
		});

		expect(principal).toMatchObject({
			actor: {
				principalId: "operator-001",
				principalType: "operator",
				userId: "operator-001",
			},
			authorization: {
				entitlementGroups: [],
				principalId: "operator-001",
				projectionSource: "operator_headers",
				retrievalFilter: {
					entitlementGroups: [],
					policyProjectionVersion: "phase1-authorization-projection-v1",
					visibilityLevel: "public",
					visibilityScope: null,
				},
				visibilityScope: null,
			},
			permissions: {
				chat: false,
				operator: true,
			},
			principal: {
				displayName: "Ops Team",
				email: "ops@example.com",
				principalId: "operator-001",
				type: "operator",
			},
			session: null,
		});
		expect(principal?.actor).not.toHaveProperty("groups");
		expect(principal?.actor).not.toHaveProperty("campusScope");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("aclGroups");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("campusScope");
	});
});

describe("campus member principal projection", () => {
	it("projects a signed-in session as a campus member by default", () => {
		const principal = mapSessionToCampusMemberPrincipal({
			session: {
				expiresAt: "2026-03-29T08:00:00.000Z",
				id: "sess_01HQ",
			},
			user: {
				email: "student@example.edu",
				id: "user_01HQ",
				name: "Jane Doe",
			},
		});

		expect(principal).toMatchObject({
			actor: {
				principalId: "user_01HQ",
				principalType: "campus_member",
				roles: ["campus_member"],
				userId: "user_01HQ",
			},
			authorization: {
				entitlementGroups: ["campus_members"],
				principalId: "user_01HQ",
				projectionSource: "campus_identity",
				retrievalFilter: {
					entitlementGroups: ["campus_members"],
					policyProjectionVersion: "phase1-authorization-projection-v1",
					visibilityLevel: "public",
					visibilityScope: null,
				},
				visibilityScope: null,
			},
			principal: {
				type: "campus_member",
			},
		});
		expect(principal?.actor).not.toHaveProperty("groups");
		expect(principal?.actor).not.toHaveProperty("campusScope");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("aclGroups");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("campusScope");
	});

	it("maps explicit campus identity claims into a campus student principal with an entitlement snapshot", () => {
		const principal = mapSessionToAppPrincipal(
			{
				session: {
					expiresAt: "2026-03-29T08:00:00.000Z",
					id: "sess_01HQ",
				},
				user: {
					email: "student@example.edu",
					id: "user_01HQ",
					name: "Jane Doe",
				},
			},
			{
				actorRoles: ["campus_member", "student"],
				applicabilityScope: "undergraduate",
				departments: ["philosophy"],
				entitlementGroups: ["campus_members", "students"],
				entitlementSnapshotId: "entitlements-2026-04-02",
				principalType: "student",
				visibilityScope: "north",
			},
		);

		expect(principal).toMatchObject({
			actor: {
				departments: ["philosophy"],
				principalId: "user_01HQ",
				principalType: "student",
				roles: ["campus_member", "student"],
				userId: "user_01HQ",
			},
			authorization: {
				applicabilityScope: "undergraduate",
				entitlementGroups: ["campus_members", "students"],
				entitlementSnapshotId: "entitlements-2026-04-02",
				principalId: "user_01HQ",
				projectionSource: "campus_identity",
				retrievalFilter: {
					entitlementGroups: ["campus_members", "students"],
					policyProjectionVersion: "phase1-authorization-projection-v1",
					visibilityLevel: "public",
					visibilityScope: "north",
				},
				visibilityScope: "north",
			},
			principal: {
				type: "student",
			},
		});
		expect(principal?.actor).not.toHaveProperty("groups");
		expect(principal?.actor).not.toHaveProperty("campusScope");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("aclGroups");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("campusScope");
	});
});

describe("request principal resolution", () => {
	beforeEach(() => {
		mockedGetAppAuth.mockReset();
	});

	it("ignores campus identity headers without a matching internal shared secret", async () => {
		mockedGetAppAuth.mockResolvedValue({
			api: {
				getSession: vi.fn().mockResolvedValue({
					session: {
						expiresAt: "2026-03-29T08:00:00.000Z",
						id: "sess_01HQ",
					},
					user: {
						email: "student@example.edu",
						id: "user_01HQ",
						name: "Jane Doe",
					},
				}),
			},
		} as never);

		const principal = await resolveRequestPrincipal(
			new Request("https://app-api.internal/api/chat/requests", {
				headers: {
					"x-app-campus-entitlement-groups": "campus_members,students",
					"x-app-campus-entitlement-snapshot-id": "entitlements-2026-04-02",
					"x-app-campus-principal-type": "student",
					"x-app-campus-visibility-scope": "north",
				},
			}),
			{
				APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
			},
		);

		expect(principal).toMatchObject({
			principal: {
				type: "campus_member",
			},
			authorization: {
				entitlementGroups: ["campus_members"],
				entitlementSnapshotId: "",
				projectionSource: "campus_identity",
				visibilityScope: null,
			},
		});
	});

	it("projects campus identity headers only for trusted internal requests", async () => {
		mockedGetAppAuth.mockResolvedValue({
			api: {
				getSession: vi.fn().mockResolvedValue({
					session: {
						expiresAt: "2026-03-29T08:00:00.000Z",
						id: "sess_01HQ",
					},
					user: {
						email: "student@example.edu",
						id: "user_01HQ",
						name: "Jane Doe",
					},
				}),
			},
		} as never);

		const principal = await resolveRequestPrincipal(
			new Request("https://app-api.internal/api/chat/requests", {
				headers: {
					"x-app-campus-actor-groups": "campus_members,students",
					"x-app-campus-actor-roles": "campus_member,student",
					"x-app-campus-applicability-scope": "undergraduate",
					"x-app-campus-departments": "philosophy",
					"x-app-campus-entitlement-groups": "campus_members,students",
					"x-app-campus-entitlement-snapshot-id": "entitlements-2026-04-02",
					"x-app-campus-principal-type": "student",
					"x-app-campus-visibility-scope": "north",
					"x-app-internal-auth": "trusted-secret",
				},
			}),
			{
				APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
			},
		);

		expect(principal).toMatchObject({
			actor: {
				departments: ["philosophy"],
				principalType: "student",
				roles: ["campus_member", "student"],
			},
			authorization: {
				applicabilityScope: "undergraduate",
				entitlementGroups: ["campus_members", "students"],
				entitlementSnapshotId: "entitlements-2026-04-02",
				projectionSource: "campus_identity",
				visibilityScope: "north",
			},
			principal: {
				type: "student",
			},
		});
		expect(principal?.actor).not.toHaveProperty("groups");
		expect(principal?.actor).not.toHaveProperty("campusScope");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("aclGroups");
		expect(principal?.authorization?.retrievalFilter).not.toHaveProperty("campusScope");
	});

	it("rejects operator route requests when the trusted operator email is not admitted", async () => {
		await expect(
			resolveRequestPrincipal(
				new Request("https://app-api.internal/api/operator/requests", {
					headers: {
						"x-app-internal-auth": "trusted-secret",
						"x-app-operator-email": "help_bot@outlook.com",
					},
				}),
				{
					APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
					APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
				},
			),
		).rejects.toMatchObject({
			code: "operator_identity_not_admitted",
			message: "Operator identity is not admitted for panel access.",
			retryable: false,
			status: 403,
		} satisfies Partial<AppApiRouteError>);

		expect(mockedGetAppAuth).not.toHaveBeenCalled();
	});

	it("rejects operator route requests when trusted internal auth is missing", async () => {
		await expect(
			resolveRequestPrincipal(
				new Request("https://app-api.internal/api/operator/requests", {
					headers: {
						"x-app-operator-email": "ops@example.com",
					},
				}),
				{
					APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
					APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
				},
			),
		).rejects.toMatchObject({
			code: "internal_auth_required",
			message: "Trusted internal shared secret required.",
			retryable: false,
			status: 401,
		} satisfies Partial<AppApiRouteError>);

		expect(mockedGetAppAuth).not.toHaveBeenCalled();
	});

	it("ignores non-admitted operator headers on non-operator surfaces and resolves session auth", async () => {
		mockedGetAppAuth.mockResolvedValue({
			api: {
				getSession: vi.fn().mockResolvedValue({
					session: {
						expiresAt: "2026-03-29T08:00:00.000Z",
						id: "sess_01HQ",
					},
					user: {
						email: "student@example.edu",
						id: "user_01HQ",
						name: "Jane Doe",
					},
				}),
			},
		} as never);

		const principal = await resolveRequestPrincipal(
			new Request("https://app-api.internal/api/chat/requests", {
				headers: {
					"x-app-internal-auth": "trusted-secret",
					"x-app-operator-email": "help_bot@outlook.com",
				},
			}),
			{
				APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
				APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
			},
		);

		expect(principal).toMatchObject({
			principal: {
				principalId: "user_01HQ",
				type: "campus_member",
			},
			permissions: {
				chat: true,
				operator: false,
			},
		});
	});
});

describe("official web collector principal resolution", () => {
	it("does not trust missing or invalid bearer tokens", async () => {
		const missing = await resolveOfficialWebCollectorPrincipal(
			new Request("https://app-api.internal/api/official-web/runs"),
			{},
		);
		const invalid = await resolveOfficialWebCollectorPrincipal(
			new Request("https://app-api.internal/api/official-web/runs", {
				headers: {
					authorization: "Bearer invalid-token",
				},
			}),
			{
				APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
			},
		);

		expect(missing).toBeNull();
		expect(invalid).toBeNull();
	});

	it("resolves the collector service principal only when the configured bearer token matches", async () => {
		const principal = await resolveOfficialWebCollectorPrincipal(
			new Request("https://app-api.internal/api/official-web/runs", {
				headers: {
					authorization: "Bearer trusted-collector-token",
				},
			}),
			{
				APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN: "trusted-collector-token",
			},
		);

		expect(principal).toEqual({
			kind: "service",
			serviceClass: "official_web_collector",
			serviceId: "official-web-collector",
		});
	});
});
