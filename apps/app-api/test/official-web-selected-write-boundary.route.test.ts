// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";

const env = {
	APP_API_NAME: "campus-agent-app-api",
	APP_API_ENVIRONMENT: "test" as const,
	APP_API_INTERNAL_SHARED_SECRET: "app-api-internal-secret",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
	EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
	EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
	APP_API_DB: {
		connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
	},
};

describe("official web selected-write app-api boundary", () => {
	it("does not expose selected-write admission, task, or executor callback routes", async () => {
		const app = createApp(env);

		const requests = [
			new Request(
				"https://app-api.internal/api/internal/official-web/target-inventory/muc-main-homepage-contact/selected-write-admissions:evaluate",
				{
					headers: { "x-app-internal-auth": "app-api-internal-secret" },
					method: "POST",
				},
			),
			new Request(
				"https://app-api.internal/api/operator/official-web/target-selected-write-admissions/owselected_muc_main_homepage_contact_pending",
			),
			new Request(
				"https://app-api.internal/api/operator/official-web/target-selected-write-admissions/owselected_muc_main_homepage_contact_pending/interventions",
				{
					body: JSON.stringify({ action: "retry_failed_task" }),
					headers: { "content-type": "application/json" },
					method: "POST",
				},
			),
			new Request(
				"https://app-api.internal/api/internal/official-web/target-selected-write-tasks/owselected_muc_main_homepage_contact_owrun_contact",
				{
					headers: { "x-app-internal-auth": "app-api-internal-secret" },
				},
			),
			new Request(
				"https://app-api.internal/api/internal/official-web/target-selected-write-tasks/owselected_muc_main_homepage_contact_owrun_contact/execution-status",
				{
					body: JSON.stringify({ status: "published" }),
					headers: {
						"content-type": "application/json",
						"x-app-internal-auth": "app-api-internal-secret",
					},
					method: "POST",
				},
			),
		];

		for (const request of requests) {
			const response = await app.fetch(request);
			expect(response.status, request.url).toBe(404);
		}
	});
});
