// @vitest-environment node

import { describe, expect, it } from "vitest";

import { runPublicWebSearchSmokeStaging } from "../scripts/public-web-search-smoke-staging";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function validPayload(url = "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/") {
	return {
		model: "gpt-5-search-api-2025-10-14",
		provider: "linux_do",
		query_text: "校园网密码怎么改",
		result_kind: "public_web_evidence",
		sources: [
			{
				content_hash: "sha256:abc",
				evidence_id: "public_web:abc",
				publisher_label: "中央民族大学",
				snippet: "校园网密码可通过数字校园相关入口处理。",
				source_kind: "public_web",
				target_kind: "public_web_url",
				title: "上网指南",
				url,
			},
		],
	};
}

describe("public web search staging smoke runner", () => {
	it("calls execution-control public web search with internal query auth and Access headers", async () => {
		const calls: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
		const result = await runPublicWebSearchSmokeStaging(
			["--query", "校园网密码怎么改"],
			{
				EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET: "query-secret",
				STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID: "access-id",
				STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET: "access-secret",
				STAGING_EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.com",
			} as NodeJS.ProcessEnv,
			{
				async fetchJson(input) {
					calls.push({
						body: input.body,
						headers: input.headers,
						url: input.url,
					});
					return jsonResponse(validPayload());
				},
			},
		);

		expect(result.passed).toBe(true);
		expect(result.samples).toEqual([
			expect.objectContaining({
				query: "校园网密码怎么改",
				resultKind: "public_web_evidence",
				sourceCount: 1,
			}),
		]);
		expect(calls).toEqual([
			{
				body: {
					payload: {
						max_results: 5,
						query_text: "校园网密码怎么改",
					},
				},
				headers: {
					"CF-Access-Client-Id": "access-id",
					"CF-Access-Client-Secret": "access-secret",
					"x-execution-query-auth": "query-secret",
				},
				url: "https://execution-control.example.com/internal/query/public-web/search",
			},
		]);
	});

	it("rejects non-public MUC source urls", async () => {
		for (const url of [
			"https://example.com/info",
			"http://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
			"https://my.muc.edu.cn/",
			"https://yx.muc.edu.cn:8443/shuzixiaoyuan/shangwangzhinan/",
		]) {
			await expect(
				runPublicWebSearchSmokeStaging(
					["--query", "校园网密码怎么改"],
					{
						EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET: "query-secret",
						STAGING_EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.com",
					} as NodeJS.ProcessEnv,
					{
						async fetchJson() {
							return jsonResponse(validPayload(url));
						},
					},
				),
			).rejects.toThrow("disallowed public_web_search source url");
		}
	});

	it("rejects raw provider or source body fields in the projection", async () => {
		await expect(
			runPublicWebSearchSmokeStaging(
				["--query", "校园网密码怎么改"],
				{
					EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET: "query-secret",
					STAGING_EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.com",
				} as NodeJS.ProcessEnv,
				{
					async fetchJson() {
						return jsonResponse({
							...validPayload(),
							sources: [
								{
									...validPayload().sources[0],
									source_body: "<html>raw</html>",
								},
							],
						});
					},
				},
			),
		).rejects.toThrow("forbidden public_web_search field");
	});

	it("reports execution-control fail-closed reasons before projection shape checks", async () => {
		await expect(
			runPublicWebSearchSmokeStaging(
				["--query", "校园网密码怎么改"],
				{
					EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET: "query-secret",
					STAGING_EXECUTION_CONTROL_BASE_URL: "https://execution-control.example.com",
				} as NodeJS.ProcessEnv,
				{
					async fetchJson() {
						return jsonResponse({
							error: {
								code: "public_web_search_provider_config_invalid",
								message: 'public_web_search provider kind = "prompt", want search',
							},
							fail_close_reason: "public_web_search_provider_config_invalid",
							outcome: "temporarily_unverifiable",
						});
					},
				},
			),
		).rejects.toThrow(
			'public_web_search failed closed: public_web_search_provider_config_invalid: public_web_search provider kind = "prompt", want search',
		);
	});
});
