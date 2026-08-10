import { afterEach, describe, expect, it, vi } from "vitest";
import { syncViaAutomationApi } from "../src/report";
import type { ExtractorConfig, SsoTgcResult } from "../src/types";

const cookieData: SsoTgcResult = {
	value: "TGT-secret-sentinel",
	domain: ".muc.edu.cn",
	path: "/",
	expires: -1,
	httpOnly: true,
	secure: true,
	extractedAt: "2026-08-10T00:00:00.000Z",
	reused: false,
};

const config: ExtractorConfig = {
	username: "student",
	password: "password",
	portalUrl: "https://my.muc.edu.cn/",
	loginUrl: "https://ca.muc.edu.cn/zfca/login",
	cookieName: "SSO_TGC",
	headed: false,
	retryTimes: 1,
	retryDelay: 0,
	storageStateDir: "",
	automationUrl: "https://ops.example.test/",
	automationToken: "ops_secret",
	credentialName: "协作者 A",
};

afterEach(() => vi.unstubAllGlobals());

function response(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		...init,
	});
}

describe("syncViaAutomationApi", () => {
	it("selects the unique named credential and performs CAS rotation", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response({
					credentials: [
						{ credentialId: "other", name: "协作者 B", version: 9 },
						{ credentialId: "target", name: "协作者 A", version: 3 },
					],
				}),
			)
			.mockResolvedValueOnce(
				response({
					credential: { credentialId: "target", name: "协作者 A", version: 4 },
				}),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(syncViaAutomationApi(config, cookieData)).resolves.toEqual({
			action: "rotated",
			credentialId: "target",
			credentialName: "协作者 A",
			previousVersion: 3,
			version: 4,
			extractedAt: cookieData.extractedAt,
			reused: false,
		});
		const [, rotateCall] = fetchMock.mock.calls;
		expect(rotateCall[0]).toBe("https://ops.example.test/api/automation/internal-portal/credentials/target");
		expect(rotateCall[1]).toMatchObject({
			method: "PUT",
			headers: {
				Authorization: "Bearer ops_secret",
				"If-Match": '"3"',
			},
			body: JSON.stringify({ ssoTgc: cookieData.value }),
		});
	});

	it("creates the stable named credential on the first run", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ credentials: [] }))
			.mockResolvedValueOnce(
				response(
					{
						credential: { credentialId: "created", name: "协作者 A", version: 1 },
					},
					{ status: 201 },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(syncViaAutomationApi(config, cookieData)).resolves.toEqual({
			action: "created",
			credentialId: "created",
			credentialName: "协作者 A",
			previousVersion: null,
			version: 1,
			extractedAt: cookieData.extractedAt,
			reused: false,
		});
		const [, createCall] = fetchMock.mock.calls;
		expect(createCall[0]).toBe(
			"https://ops.example.test/api/automation/internal-portal/credentials",
		);
		expect(createCall[1]).toMatchObject({
			method: "POST",
			headers: {
				Authorization: "Bearer ops_secret",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "协作者 A", ssoTgc: cookieData.value }),
		});
	});

	it("adopts a credential created by a concurrent first run", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ credentials: [] }))
			.mockResolvedValueOnce(
				response({ error: { code: "OPS_INTERNAL_PORTAL_NAME_CONFLICT" } }, { status: 409 }),
			)
			.mockResolvedValueOnce(
				response({ credentials: [{ credentialId: "created", name: "协作者 A", version: 1 }] }),
			)
			.mockResolvedValueOnce(
				response({ credential: { credentialId: "created", name: "协作者 A", version: 2 } }),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(syncViaAutomationApi(config, cookieData)).resolves.toMatchObject({
			action: "rotated",
			credentialId: "created",
			previousVersion: 1,
			version: 2,
		});
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
			method: "PUT",
			headers: { "If-Match": '"1"' },
		});
	});

	it("rejects an ambiguous named credential", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				response({
					credentials: [
						{ credentialId: "a", name: "协作者 A", version: 1 },
						{ credentialId: "b", name: "协作者 A", version: 2 },
					],
				}),
			),
		);
		await expect(syncViaAutomationApi(config, cookieData)).rejects.toThrow("找到 2 条");
	});

	it("does not expose a sensitive response body on API failure", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				response({
					credentials: [{ credentialId: "target", name: "协作者 A", version: 3 }],
				}),
			)
			.mockResolvedValueOnce(
				response({ secret: cookieData.value }, { status: 409, statusText: "Conflict" }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const error = await syncViaAutomationApi(config, cookieData).catch(
			(value: unknown) => value,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe("轮换凭据失败: HTTP 409");
		expect((error as Error).message).not.toContain(cookieData.value);
	});

	it.each([422, 503])(
		"reports validation failure HTTP %s without response data",
		async (status) => {
			vi.stubGlobal(
				"fetch",
				vi
					.fn()
					.mockResolvedValueOnce(
						response({
							credentials: [{ credentialId: "target", name: "协作者 A", version: 3 }],
						}),
					)
					.mockResolvedValueOnce(response({ secret: cookieData.value }, { status })),
			);
			const error = await syncViaAutomationApi(config, cookieData).catch(
				(value: unknown) => value,
			);
			expect((error as Error).message).toBe(`轮换凭据失败: HTTP ${status}`);
			expect((error as Error).message).not.toContain(cookieData.value);
		},
	);

	it("reports list API failure without parsing its response body", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(response({ secret: cookieData.value }, { status: 503 })),
		);
		const error = await syncViaAutomationApi(config, cookieData).catch(
			(value: unknown) => value,
		);
		expect((error as Error).message).toBe("获取凭据列表失败: HTTP 503");
		expect((error as Error).message).not.toContain(cookieData.value);
	});

	it("sanitizes network errors from both API calls", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error(`network ${cookieData.value}`));
		vi.stubGlobal("fetch", fetchMock);
		const listError = await syncViaAutomationApi(config, cookieData).catch(
			(value: unknown) => value,
		);
		expect((listError as Error).message).toBe("获取凭据列表失败：请求未完成。");

		fetchMock
			.mockReset()
			.mockResolvedValueOnce(
				response({ credentials: [{ credentialId: "target", name: "协作者 A", version: 3 }] }),
			)
			.mockRejectedValueOnce(new Error(`network ${cookieData.value}`));
		const rotateError = await syncViaAutomationApi(config, cookieData).catch(
			(value: unknown) => value,
		);
		expect((rotateError as Error).message).toBe("轮换凭据失败：请求未完成。");

		fetchMock
			.mockReset()
			.mockResolvedValueOnce(response({ credentials: [] }))
			.mockRejectedValueOnce(new Error(`network ${cookieData.value}`));
		const createError = await syncViaAutomationApi(config, cookieData).catch(
			(value: unknown) => value,
		);
		expect((createError as Error).message).toBe("创建凭据失败：请求未完成。");
	});

	it("does not expose a sensitive create response body", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(response({ credentials: [] }))
				.mockResolvedValueOnce(
					response({ secret: cookieData.value }, { status: 409, statusText: "Conflict" }),
				)
				.mockResolvedValueOnce(response({ credentials: [] })),
		);
		const error = await syncViaAutomationApi(config, cookieData).catch(
			(value: unknown) => value,
		);
		expect((error as Error).message).toBe("创建凭据失败: HTTP 409");
		expect((error as Error).message).not.toContain(cookieData.value);
	});

	it("fails before fetch when rotation configuration is incomplete", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(
			syncViaAutomationApi({ ...config, automationToken: "" }, cookieData),
		).rejects.toThrow("SSO_TGC_EXTRACTOR_AUTOMATION_TOKEN 未设置");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
