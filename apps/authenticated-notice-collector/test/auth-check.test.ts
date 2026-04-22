import { describe, expect, it } from "vitest";

import { checkAuth } from "../src/auth-check";

describe("authenticated notice collector auth check", () => {
	it("returns per-surface readiness summaries and disposes the request context", async () => {
		let disposed = false;

		const result = await checkAuth({
			authCheckNoticeType: "5",
			authCheckPageSize: 3,
			createApiContext: async () => ({
				get: async () => ({
					body: async () => Buffer.from(""),
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
				}),
				post: async () => ({
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
				}),
				dispose: async () => {
					disposed = true;
				},
			}),
			fetchNoticePage: async () => ({
				datas: {
					tables: [{ notice_id: 355119, notice_title: "关于报名的通知" }],
				},
				state: true,
			}),
			fetchFileReleasePage: async () => ({
				data: [{ filename: "推荐免试办法", id: 646, typename: "教学管理" }],
				state: true,
			}),
		});

		expect(result).toEqual({
			fileRelease: {
				firstFileReleaseId: 646,
				firstFilename: "推荐免试办法",
				firstFileTypeName: "教学管理",
				sampleCount: 1,
			},
			notice: {
				firstNoticeId: 355119,
				firstTitle: "关于报名的通知",
				sampleCount: 1,
			},
			ok: true,
		});
		expect(disposed).toBe(true);
	});

	it("fails closed when the session cannot access notice data", async () => {
		await expect(
			checkAuth({
				authCheckNoticeType: "5",
				authCheckPageSize: 3,
				createApiContext: async () => ({
					get: async () => ({
						body: async () => Buffer.from(""),
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					}),
					post: async () => ({
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					}),
					dispose: async () => {},
				}),
				fetchNoticePage: async () => ({
					datas: { tables: [] },
					state: true,
				}),
				fetchFileReleasePage: async () => ({
					data: [{ filename: "推荐免试办法", id: 646, typename: "教学管理" }],
					state: true,
				}),
			}),
		).rejects.toThrow("auth check failed: notice surface unavailable");
	});

	it("fails closed when file release is unavailable even if notice works", async () => {
		await expect(
			checkAuth({
				authCheckNoticeType: "5",
				authCheckPageSize: 3,
				createApiContext: async () => ({
					get: async () => ({
						body: async () => Buffer.from(""),
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					}),
					post: async () => ({
						json: async () => ({}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
					}),
					dispose: async () => {},
				}),
				fetchNoticePage: async () => ({
					datas: {
						tables: [{ notice_id: 355119, notice_title: "关于报名的通知" }],
					},
					state: true,
				}),
				fetchFileReleasePage: async () => ({
					data: [],
					state: true,
				}),
			}),
		).rejects.toThrow("auth check failed: file_release surface unavailable");
	});
});
