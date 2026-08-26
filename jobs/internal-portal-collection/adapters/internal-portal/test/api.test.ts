import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
	fetchAttachmentBinary,
	fetchFileReleaseDetail,
	fetchFileReleaseDownloadUrl,
	fetchNoticeDetail,
	fetchNoticeMetadata,
	fetchNoticePage,
} from "../src/api.js";
import { PortalSessionExpiredError } from "../src/auth-errors.js";

describe("internal portal collection api", () => {
	it("posts notice page requests and reports HTTP failures", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				return {
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
					text: async () => "{}",
				};
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				return {
					ok: () => false,
					status: () => 500,
					statusText: () => "server error",
					text: async () => "server error",
				};
			},
		};

		await expect(
			fetchNoticePage({
				apiContext,
				currentPage: 1,
				endDate: "2026-04-30",
				startDate: "2026-04-01",
			}),
		).rejects.toThrow(
			"Internal portal notice list request failed: HTTP 500 server error: server error",
		);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.path).toBe("/comsys-portal-notice-web/getNoticeByPage");
		expect(calls[0]?.form.type).toBe("");
		expect(calls[0]?.form.currentPage).toBe("1");
		expect(calls[0]?.form.pageSize).toBe("20");
		expect(calls[0]?.form.end_date).toBe("2026-04-30");
	});

	it("reads the complete notice selector mappings", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				throw new Error("unexpected get");
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				return {
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
					text: async () =>
						JSON.stringify({
							datas: {
								org: [{ organization_id: "00007", organization_name: "党委保卫部、保卫处" }],
								type: [{ notice_type_id: 5, notice_type_name: "办公通知" }],
							},
							state: true,
						}),
				};
			},
		};

		await expect(fetchNoticeMetadata({ apiContext })).resolves.toMatchObject({ state: true });
		expect(calls).toEqual([{ path: "/comsys-portal-notice-web/getNoticeSlects", form: {} }]);
	});

	it("requests notice detail by id without a type prerequisite", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				throw new Error("unexpected get");
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				return {
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
					text: async () =>
						JSON.stringify({ datas: { notice_info: { notice_id: 358159 } }, state: true }),
				};
			},
		};

		await fetchNoticeDetail({ apiContext, noticeId: 358159 });
		expect(calls[0]).toMatchObject({
			form: { notice_id: "358159", type: "" },
			path: "/comsys-portal-notice-web/getNotice",
		});
	});

	it("treats comsys session invalid payloads as auth expiry", async () => {
		const apiContext = {
			async get() {
				return {
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
					text: async () => "{}",
				};
			},
			async post() {
				return {
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
					text: async () => "error_comsys_session_invalid",
				};
			},
		};

		await expect(
			fetchNoticePage({
				apiContext,
				currentPage: 1,
				startDate: "2026-04-01",
			}),
		).rejects.toThrow("getNoticeByPage failed: session invalid");
	});

	it("downloads attachment bytes and exposes filename headers", async () => {
		const apiContext = {
			async get() {
				return {
					bodyStream: () => byteStream("hello"),
					headers: () => ({
						"content-disposition": "attachment; filename*=UTF-8''sample.docx",
						"content-type":
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8",
					}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
					text: async () => "hello",
				};
			},
			async post() {
				throw new Error("unexpected post");
			},
		};

		const result = await fetchAttachmentBinary({
			apiContext,
			attachmentUrl: "https://portal.example.edu/download?id=1",
		});

		expect(await readFile(result.filePath, "utf-8")).toBe("hello");
		expect(result.contentDisposition).toBe("attachment; filename*=UTF-8''sample.docx");
		expect(result.contentType).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8",
		);
		await result.remove();
	});

	it("rejects oversized attachments from content-length before reading the body", async () => {
		const bodyStream = vi.fn(() => byteStream("must-not-read"));
		const cancelBody = vi.fn(async () => undefined);
		await expect(
			fetchAttachmentBinary({
				apiContext: {
					get: async () => ({
						bodyStream,
						cancelBody,
						headers: () => ({ "content-length": String(50 * 1024 * 1024 + 1) }),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () => "",
					}),
					post: async () => {
						throw new Error("unexpected post");
					},
				},
				attachmentUrl: "https://portal.example.edu/download?id=large",
				maxBytes: 50 * 1024 * 1024,
			}),
		).rejects.toThrow("Attachment size exceeds the configured limit.");
		expect(bodyStream).not.toHaveBeenCalled();
		expect(cancelBody).toHaveBeenCalledOnce();
	});

	it("fails a streamed session marker without retrying the request", async () => {
		await expect(
			fetchAttachmentBinary({
				apiContext: {
					get: async () => ({
						bodyStream: () => byteStream("error_comsys_session_invalid"),
						headers: () => ({ "content-type": "text/plain" }),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () => "error_comsys_session_invalid",
					}),
					post: async () => {
						throw new Error("unexpected post");
					},
				},
				attachmentUrl: "https://portal.example.edu/download?id=expired",
			}),
		).rejects.toBeInstanceOf(PortalSessionExpiredError);
	});

	it("reports rate limiting without an application retry", async () => {
		const cancelBody = vi.fn(async () => undefined);
		await expect(
			fetchNoticePage({
				apiContext: {
					get: async () => {
						throw new Error("unexpected get");
					},
					post: async () => ({
						cancelBody,
						headers: () => ({ "retry-after": "2" }),
						ok: () => false,
						status: () => 429,
						statusText: () => "Too Many Requests",
						text: async () => "rate limited",
					}),
				},
				currentPage: 1,
				startDate: "2026-04-01",
			}),
		).rejects.toThrow(
			"Internal portal notice list request failed: HTTP 429 Too Many Requests: rate limited",
		);
		expect(cancelBody).toHaveBeenCalledOnce();
	});

	it("posts file release requests and parses detail and download URL payloads", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				throw new Error("unexpected get");
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				if (path === "/comsys-prompt-portlet-web/getFile") {
					return {
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () =>
							JSON.stringify({
								filecode: "民大校发〔2026〕39号",
								filedepartment: "教务处",
								filename: "示例大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
								filetime: "2026-03-31 13:51:11",
								filetypeid: 18,
								fileurl: "/comsys/20181214/webapps/comsys-prompt-portlet-web/file/sample.pdf",
								id: 646,
								state: 1,
								upfilename: "示例大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法.pdf",
							}),
					};
				}
				if (path === "/comsys-prompt-portlet-web/getFileUrl") {
					return {
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () =>
							JSON.stringify({
								state: true,
								url: "/comsys-prompt-portlet-web/file/sample.pdf",
							}),
					};
				}
				throw new Error(`unexpected path: ${path}`);
			},
		};

		const detail = await fetchFileReleaseDetail({
			apiContext,
			fileReleaseId: 646,
		});
		const downloadUrl = await fetchFileReleaseDownloadUrl({
			apiContext,
			fileReleaseId: 646,
		});
		expect(detail.id).toBe(646);
		expect(downloadUrl.url).toBe("/comsys-prompt-portlet-web/file/sample.pdf");
		expect(calls).toEqual([
			{
				path: "/comsys-prompt-portlet-web/getFile",
				form: {
					id: "646",
				},
			},
			{
				path: "/comsys-prompt-portlet-web/getFileUrl",
				form: {
					id: "646",
				},
			},
		]);
	});
});

async function* byteStream(payload: string): AsyncIterable<Uint8Array> {
	yield new TextEncoder().encode(payload);
}
