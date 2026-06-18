// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { resolveRequestPrincipal } from "../src/modules/auth";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_INTERNAL_SHARED_SECRET: "trusted-secret",
	CHATKIT_ADAPTER_BASE_URL: "https://chatkit-adapter.internal",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

function createCampusPrincipal() {
	return {
		actor: {
			cohort: "2026",
			departments: ["信息工程学院"],
			major: "计算机科学",
			principalId: "user_01HQ",
			principalType: "campus_member",
			program: "本科",
			roles: ["campus_member", "student"],
			userId: "user_01HQ",
		},
		authorization: {
			applicabilityScope: "undergraduate",
			approvalState: "",
			entitlementGroups: ["campus_members", "students", "restricted_docs"],
			entitlementSnapshotId: "ent_snapshot_01",
			ownershipScopes: ["self", "class_01"],
			principalId: "user_01HQ",
			projectionSource: "campus_identity" as const,
			retrievalFilter: {
				entitlementGroups: ["campus_members", "students", "restricted_docs"],
				policyProjectionVersion: "phase1-authorization-projection-v1",
				visibilityLevel: "restricted",
				visibilityScope: "muc",
			},
			visibilityScope: "muc",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu",
			principalId: "user_01HQ",
			type: "campus_member" as const,
		},
		session: {
			expiresAt: "2026-03-29T07:00:00.000Z",
			sessionId: "sess_01HQ",
		},
	};
}

describe("POST /api/chatkit", () => {
	it("fails closed when no principal is available", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn().mockResolvedValue(null),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chatkit", {
				body: JSON.stringify({ type: "threads.list" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(401);
		const body = await response.text();
		expect(body).toContain("请先登录。");
		expect(body).not.toContain("adapter");
		expect(body).not.toContain("fetch failed");
	});

	it("forwards authenticated ChatKit requests with service auth and principal headers", async () => {
		const fetchChatKitAdapter = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: {
					"content-type": "application/json",
					"x-chatkit-adapter": "seen",
				},
				status: 200,
			}),
		);
		const app = createApp(env, {
			fetchChatKitAdapter,
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chatkit?cursor=1", {
				body: JSON.stringify({ type: "threads.list" }),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=session-token",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(fetchChatKitAdapter).toHaveBeenCalledOnce();
		const forwarded = fetchChatKitAdapter.mock.calls[0][0] as Request;
		expect(forwarded.url).toBe("https://chatkit-adapter.internal/chatkit?cursor=1");
		expect(forwarded.headers.get("x-app-internal-auth")).toBe("trusted-secret");
		expect(forwarded.headers.get("x-app-campus-principal-id")).toBe("user_01HQ");
		expect(forwarded.headers.get("x-app-campus-display-name")).toBe("Jane Doe");
		expect(forwarded.headers.get("x-app-campus-email")).toBe("jane@example.edu");
		expect(forwarded.headers.get("x-app-campus-principal-type")).toBe("campus_member");
		expect(forwarded.headers.get("x-app-campus-actor-roles")).toBe("campus_member,student");
		expect(forwarded.headers.get("x-app-campus-departments")).toBe("b64:5L+h5oGv5bel56iL5a2m6Zmi");
		expect(forwarded.headers.get("x-app-campus-cohort")).toBe("2026");
		expect(forwarded.headers.get("x-app-campus-major")).toBe("b64:6K6h566X5py656eR5a2m");
		expect(forwarded.headers.get("x-app-campus-program")).toBe("b64:5pys56eR");
		expect(forwarded.headers.get("x-app-campus-entitlement-snapshot-id")).toBe("ent_snapshot_01");
		expect(forwarded.headers.get("x-app-campus-entitlement-groups")).toBe(
			"campus_members,students,restricted_docs",
		);
		expect(forwarded.headers.get("x-app-campus-visibility-level")).toBe("restricted");
		expect(forwarded.headers.get("x-app-campus-visibility-scope")).toBe("muc");
		expect(forwarded.headers.get("x-app-campus-applicability-scope")).toBe("undergraduate");
		expect(forwarded.headers.get("x-app-campus-ownership-scopes")).toBe("self,class_01");
		expect(forwarded.headers.get("cookie")).toBeNull();
		await expect(forwarded.text()).resolves.toBe(JSON.stringify({ type: "threads.list" }));
	});

	it("fails closed when the adapter URL is not a valid absolute URL", async () => {
		const app = createApp(
			{
				...env,
				CHATKIT_ADAPTER_BASE_URL: "not-a-url",
			},
			{
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
			},
		);

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chatkit", {
				body: JSON.stringify({ type: "threads.list" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(503);
	});

	it("returns product error copy when the adapter fetch fails", async () => {
		const app = createApp(env, {
			fetchChatKitAdapter: vi.fn().mockRejectedValue(new Error("adapter stack fetch failed")),
			getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
		});

		const response = await app.fetch(
			new Request("https://app-api.internal/api/chatkit", {
				body: JSON.stringify({ type: "threads.create" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		);

		expect(response.status).toBe(503);
		const body = await response.text();
		expect(body).toContain("服务暂不可用，请稍后再试。");
		expect(body).not.toContain("adapter");
		expect(body).not.toContain("fetch failed");
	});

	it("admits adapter service callbacks through signed principal headers without browser cookies", async () => {
		const request = new Request("https://app-api.internal/api/chat/conversations", {
			headers: {
				"x-app-campus-display-name": "Jane Doe",
				"x-app-campus-email": "jane@example.edu",
				"x-app-campus-entitlement-groups": "campus_members,students,restricted_docs",
				"x-app-campus-entitlement-snapshot-id": "ent_snapshot_01",
				"x-app-campus-principal-id": "user_01HQ",
				"x-app-campus-principal-type": "campus_member",
				"x-app-campus-visibility-level": "restricted",
				"x-app-campus-visibility-scope": "muc",
				"x-app-internal-auth": "trusted-secret",
			},
			method: "GET",
		});

		await expect(resolveRequestPrincipal(request, env)).resolves.toMatchObject({
			permissions: { chat: true, operator: false },
			principal: {
				displayName: "Jane Doe",
				email: "jane@example.edu",
				principalId: "user_01HQ",
				type: "campus_member",
			},
			session: null,
			authorization: {
				entitlementGroups: ["campus_members", "students", "restricted_docs"],
				entitlementSnapshotId: "ent_snapshot_01",
				retrievalFilter: {
					visibilityLevel: "restricted",
					visibilityScope: "muc",
				},
				visibilityScope: "muc",
			},
		});
	});
});
