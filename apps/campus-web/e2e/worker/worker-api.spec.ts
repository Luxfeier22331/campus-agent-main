import { type APIResponse, expect, test } from "@playwright/test";

const WORKER_UNKNOWN_API_PAYLOAD = {
	error: {
		code: "not_found",
		message: "这个接口不存在。",
	},
};

test.describe("campus web worker app-api boundary", () => {
	test("routes admitted discovery and current account API paths to app-api", async ({
		request,
	}) => {
		for (const path of [
			"/.well-known/openid-configuration",
			"/.well-known/oauth-authorization-server",
			"/api/me",
		]) {
			const response = await request.get(path);

			await expectNotWorkerUnknownApi(response);
		}

		for (const path of [
			"/api/me/overview",
			"/api/me/identity",
			"/api/me/access",
			"/api/me/preferences",
			"/api/me/admin",
		]) {
			await expectWorkerUnknownApi(await request.get(path));
		}
	});

	test("routes admitted profile memory paths and keeps retired account projections closed", async ({
		request,
	}) => {
		for (const { method, path } of [
			{ method: "GET", path: "/api/me/profile-memory" },
			{ method: "POST", path: "/api/me/profile-memory/items" },
			{ method: "PATCH", path: "/api/me/profile-memory/items/mem_e2e" },
			{ method: "PATCH", path: "/api/me/profile-memory/settings" },
			{ method: "DELETE", path: "/api/me/profile-memory/items/mem_e2e" },
			{ method: "DELETE", path: "/api/me/profile-memory" },
		]) {
			const response = await request.fetch(path, {
				data: method === "GET" ? undefined : {},
				method,
			});

			await expectNotWorkerUnknownApi(response);
		}

		for (const path of [
			"/api/me/security/sessions",
			"/api/me/security/sessions/session_e2e",
			"/api/me/authorized-apps",
			"/api/me/authorized-apps/muc-wiki-e2e",
			"/api/me/profile-memory/export",
		]) {
			await expectWorkerUnknownApi(await request.get(path));
		}
	});

	test("routes admitted auth API paths to app-api and keeps unknown auth paths closed", async ({
		request,
	}) => {
		for (const path of [
			"/api/auth/get-session",
			"/api/auth/list-accounts",
			"/api/auth/list-sessions",
			"/api/auth/sign-in/email",
			"/api/auth/sign-up/email",
			"/api/auth/sign-out",
			"/api/auth/request-password-reset",
			"/api/auth/reset-password",
		]) {
			const response = await request.post(path, { data: {} });

			await expectNotWorkerUnknownApi(response);
		}

		await expectWorkerUnknownApi(await request.get("/api/auth/admin"));
	});

	test("routes admitted chat API paths to app-api and keeps unknown chat paths closed", {
		tag: "@smoke",
	}, async ({ request }) => {
		for (const { method, path } of [
			{ method: "GET", path: "/api/chat/conversations" },
			{ method: "GET", path: "/api/chat/conversations/search" },
			{ method: "GET", path: "/api/chat/conversations/conv_e2e" },
			{ method: "POST", path: "/api/chat/conversations/conv_e2e/archive" },
			{ method: "DELETE", path: "/api/chat/conversations/conv_e2e" },
			{ method: "POST", path: "/api/chat/conversations/conv_e2e/messages/msg_e2e/feedback" },
			{ method: "DELETE", path: "/api/chat/conversations/conv_e2e/messages/msg_e2e/trailing" },
			{ method: "POST", path: "/api/chat/requests/stream" },
			{ method: "POST", path: "/api/chat/runs/run_e2e/cancel" },
		]) {
			const response = await request.fetch(path, {
				data: method === "GET" ? undefined : {},
				method,
			});

			await expectNotWorkerUnknownApi(response);
		}

		await expectWorkerUnknownApi(await request.get("/api/chat/admin"));
	});

	test("routes admitted feedback API paths to app-api and keeps unknown support paths closed", async ({
		request,
	}) => {
		for (const { method, path } of [{ method: "POST", path: "/api/feedback" }]) {
			const response = await request.fetch(path, {
				data: method === "GET" ? undefined : {},
				method,
			});

			await expectNotWorkerUnknownApi(response);
		}
	});

	test("keeps retired docs API paths closed", async ({ request }) => {
		for (const path of [
			"/api/docs/readyz",
			"/api/docs/collections/regulations/student_rules/navigation",
		]) {
			await expectWorkerUnknownApi(await request.get(path));
		}
	});
});

async function expectNotWorkerUnknownApi(response: APIResponse): Promise<void> {
	expect(response.headers()["content-type"]).toMatch(/application\/json/);
	await expect(response.json()).resolves.not.toEqual(WORKER_UNKNOWN_API_PAYLOAD);
}

async function expectWorkerUnknownApi(response: APIResponse): Promise<void> {
	expect(response.status()).toBe(404);
	expect(response.headers()["content-type"]).toMatch(/application\/json/);
	await expect(response.json()).resolves.toEqual(WORKER_UNKNOWN_API_PAYLOAD);
}
