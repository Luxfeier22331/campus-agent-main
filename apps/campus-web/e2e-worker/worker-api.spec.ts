import { type APIResponse, expect, test } from "@playwright/test";

const WORKER_UNKNOWN_API_PAYLOAD = {
	error: {
		code: "not_found",
		message: "这个接口不存在。",
	},
};

test.describe("campus web worker app-api boundary", () => {
	test("routes admitted discovery and account API paths to app-api", async ({ request }) => {
		for (const path of [
			"/.well-known/openid-configuration",
			"/.well-known/oauth-authorization-server",
			"/api/me",
			"/api/me/overview",
			"/api/me/identity",
			"/api/me/access",
			"/api/me/preferences",
		]) {
			const response = await request.get(path);

			await expectNotWorkerUnknownApi(response);
		}

		await expectWorkerUnknownApi(await request.get("/api/me/admin"));
	});

	test("routes admitted profile memory and account management paths to app-api", async ({
		request,
	}) => {
		for (const { method, path } of [
			{ method: "GET", path: "/api/me/profile-memory" },
			{ method: "GET", path: "/api/me/profile-memory/items" },
			{ method: "GET", path: "/api/me/profile-memory/settings" },
			{ method: "DELETE", path: "/api/me/profile-memory/items/mem_e2e" },
			{ method: "GET", path: "/api/me/security/sessions" },
			{ method: "DELETE", path: "/api/me/security/sessions/session_e2e" },
			{ method: "GET", path: "/api/me/authorized-apps" },
			{ method: "DELETE", path: "/api/me/authorized-apps/muc-wiki-e2e" },
		]) {
			const response = await request.fetch(path, { method });

			await expectNotWorkerUnknownApi(response);
		}

		await expectWorkerUnknownApi(await request.get("/api/me/profile-memory/export"));
	});

	test("routes admitted auth API paths to app-api and keeps unknown auth paths closed", async ({
		request,
	}) => {
		for (const path of [
			"/api/auth/get-session",
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

	test("routes admitted chat API paths to app-api and keeps unknown chat paths closed", async ({
		request,
	}) => {
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

	test("routes admitted campus support API paths to app-api and keeps unknown support paths closed", async ({
		request,
	}) => {
		for (const { method, path } of [
			{ method: "GET", path: "/api/campus-services/transport-schedule/status" },
			{ method: "POST", path: "/api/feedback" },
		]) {
			const response = await request.fetch(path, {
				data: method === "GET" ? undefined : {},
				method,
			});

			await expectNotWorkerUnknownApi(response);
		}

		await expectWorkerUnknownApi(await request.get("/api/campus-services/admin"));
	});

	test("routes admitted docs API paths to app-api and keeps unknown docs paths closed", async ({
		request,
	}) => {
		for (const path of [
			"/api/docs/readyz",
			"/api/docs/collections/regulations/student_rules/navigation",
			"/api/docs/collections/regulations/student_rules/documents/doc-c62077b20430",
			"/api/docs/collections/regulations/student_rules/documents/doc-c62077b20430/resolve",
			"/api/docs/collections/regulations/student_rules/documents/doc-c62077b20430/versions",
			"/api/docs/collections/regulations/student_rules/documents/doc-c62077b20430/admission",
		]) {
			const response = await request.get(path);

			await expectNotWorkerUnknownApi(response);
		}

		await expectWorkerUnknownApi(
			await request.get("/api/docs/collections/regulations/student_rules/search"),
		);
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
