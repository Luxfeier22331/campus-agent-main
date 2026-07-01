import { describe, expect, it } from "vitest";

import {
	fetchAttachmentBinary,
	fetchFileReleaseCodeTypes,
	fetchFileReleaseDetail,
	fetchFileReleaseDownloadUrl,
	fetchFileReleaseExplainDepartments,
	fetchFileReleasePage,
	fetchFileReleaseTypes,
	fetchNoticePage,
	fetchNoticeSelects,
} from "../src/api.js";

describe("authenticated notice collector api", () => {
	it("posts notice page requests and leaves retryable failures to the Crawlee runner", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				return {
					body: async () => Buffer.from(""),
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
				};
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				return {
					json: async () => ({}),
					ok: () => false,
					status: () => 500,
					statusText: () => "server error",
				};
			},
		};

		await expect(
			fetchNoticePage({
				apiContext,
				currentPage: 1,
				noticeType: "5",
				pageSize: 3,
			}),
		).rejects.toThrow("getNoticeByPage failed: 500 server error");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.path).toBe("/comsys-portal-notice-web/getNoticeByPage");
		expect(calls[0]?.form.type).toBe("5");
		expect(calls[0]?.form.currentPage).toBe("1");
		expect(calls[0]?.form.pageSize).toBe("3");
	});

	it("treats comsys session invalid payloads as auth expiry", async () => {
		const apiContext = {
			async get() {
				return {
					body: async () => Buffer.from(""),
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
				};
			},
			async post() {
				return {
					json: async () => ({}),
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
				noticeType: "5",
				pageSize: 3,
			}),
		).rejects.toThrow("auth-expired: getNoticeByPage failed: session invalid");
	});

	it("downloads attachment bytes and exposes response headers", async () => {
		const apiContext = {
			async get() {
				return {
					body: async () => Buffer.from("hello"),
					headers: () => ({
						"content-disposition": "attachment; filename*=UTF-8''sample.docx",
						"content-type":
							"application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8",
						etag: '"etag-1"',
					}),
					json: async () => ({}),
					ok: () => true,
					status: () => 200,
					statusText: () => "OK",
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

		expect(result.body.toString("utf-8")).toBe("hello");
		expect(result.contentDisposition).toBe("attachment; filename*=UTF-8''sample.docx");
		expect(result.contentType).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8",
		);
		expect(result.etag).toBe('"etag-1"');
		expect(result.statusCode).toBe(200);
	});

	it("posts file release requests and parses page, detail, type, and url payloads", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				throw new Error("unexpected get");
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				if (path === "/comsys-prompt-portlet-web/pageFile") {
					return {
						json: async () => ({
							data: [
								{
									filecode: "民大校发〔2026〕39号",
									filename: "示例大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
									filetime: "2026-03-31 13:51:11",
									filedepartment: "教务处",
									id: 646,
									typename: "教学管理",
								},
							],
							dws: [{ filedepartment: "教务处" }],
							size: 1,
							state: true,
							sync: false,
						}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () =>
							JSON.stringify({
								data: [
									{
										filecode: "民大校发〔2026〕39号",
										filename: "示例大学推荐优秀应届本科毕业生免试攻读硕士学位研究生管理办法",
										filetime: "2026-03-31 13:51:11",
										filedepartment: "教务处",
										id: 646,
										typename: "教学管理",
									},
								],
								dws: [{ filedepartment: "教务处" }],
								size: 1,
								state: true,
								sync: false,
							}),
					};
				}
				if (path === "/comsys-prompt-portlet-web/getFile") {
					return {
						json: async () => ({
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
						json: async () => ({
							state: true,
							url: "/comsys-prompt-portlet-web/file/sample.pdf",
						}),
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
				if (path === "/comsys-prompt-portlet-web/getFileType") {
					return {
						json: async () => ({
							data: [
								{
									id: 18,
									sort: 3,
									typename: "教学管理",
								},
							],
							state: true,
						}),
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () =>
							JSON.stringify({
								data: [
									{
										id: 18,
										sort: 3,
										typename: "教学管理",
									},
								],
								state: true,
							}),
					};
				}
				throw new Error(`unexpected path: ${path}`);
			},
		};

		const page = await fetchFileReleasePage({
			apiContext,
			currentPage: 1,
			pageSize: 10,
		});
		const detail = await fetchFileReleaseDetail({
			apiContext,
			fileReleaseId: 646,
		});
		const downloadUrl = await fetchFileReleaseDownloadUrl({
			apiContext,
			fileReleaseId: 646,
		});
		const fileTypes = await fetchFileReleaseTypes({
			apiContext,
		});

		expect(page.data?.[0]?.id).toBe(646);
		expect(detail.id).toBe(646);
		expect(downloadUrl.url).toBe("/comsys-prompt-portlet-web/file/sample.pdf");
		expect(fileTypes.data?.[0]?.typename).toBe("教学管理");
		expect(calls).toEqual([
			{
				path: "/comsys-prompt-portlet-web/pageFile",
				form: {
					currentPage: "1",
					pageSize: "10",
					mng: "1",
					order: "name,time",
				},
			},
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
			{
				path: "/comsys-prompt-portlet-web/getFileType",
				form: {},
			},
		]);
	});

	it("leaves file-release retryable failures to the Crawlee runner", async () => {
		const calls: string[] = [];
		const apiContext = {
			async get() {
				throw new Error("unexpected get");
			},
			async post(path: string) {
				calls.push(path);
				return {
					json: async () => ({}),
					ok: () => false,
					status: () => 500,
					statusText: () => "server error",
					text: async () => JSON.stringify({ state: false }),
				};
			},
		};

		await expect(
			fetchFileReleasePage({
				apiContext,
				currentPage: 1,
				pageSize: 10,
			}),
		).rejects.toThrow("pageFile failed: 500 server error");

		expect(calls).toEqual(["/comsys-prompt-portlet-web/pageFile"]);
	});

	it("fetches notice and file-release selector snapshots for taxonomy exports", async () => {
		const calls: Array<{ path: string; form: Record<string, string> }> = [];
		const apiContext = {
			async get() {
				throw new Error("unexpected get");
			},
			async post(path: string, input: { form: Record<string, string> }) {
				calls.push({ path, form: input.form });
				if (path === "/comsys-portal-notice-web/getNoticeSlects") {
					const payload = {
						datas: {
							org: [
								{
									organization_id: "00011",
									organization_name: "教务处（考试中心、教师教学发展中心）",
								},
							],
							type: [
								{
									notice_type_id: 5,
									notice_type_name: "办公通知",
								},
								{
									notice_type_id: 6,
									notice_type_name: "教学通知",
								},
							],
						},
						state: true,
					};
					return {
						json: async () => payload,
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () => JSON.stringify(payload),
					};
				}
				if (path === "/comsys-prompt-portlet-web/getExplainDepts") {
					const payload = {
						data: [
							{
								ORGANIZATION_NAME: "教务处（考试中心、教师教学发展中心）",
							},
						],
						state: true,
					};
					return {
						json: async () => payload,
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () => JSON.stringify(payload),
					};
				}
				if (path === "/comsys-prompt-portlet-web/getFileFileType") {
					const payload = {
						data: [
							{
								id: 2,
								name: "民大校发",
								sort: 2,
							},
						],
						state: true,
					};
					return {
						json: async () => payload,
						ok: () => true,
						status: () => 200,
						statusText: () => "OK",
						text: async () => JSON.stringify(payload),
					};
				}
				throw new Error(`unexpected path: ${path}`);
			},
		};

		const noticeSelects = await fetchNoticeSelects({
			apiContext,
			currentPage: 1,
			pageSize: 15,
		});
		const explainDepartments = await fetchFileReleaseExplainDepartments({
			apiContext,
		});
		const codeTypes = await fetchFileReleaseCodeTypes({
			apiContext,
		});

		expect(noticeSelects.datas?.type).toHaveLength(2);
		expect(noticeSelects.datas?.org?.[0]?.organization_name).toBe(
			"教务处（考试中心、教师教学发展中心）",
		);
		expect(explainDepartments.data?.[0]?.ORGANIZATION_NAME).toBe(
			"教务处（考试中心、教师教学发展中心）",
		);
		expect(codeTypes.data?.[0]?.name).toBe("民大校发");
		expect(calls).toEqual([
			{
				form: {
					comsys_random_t: expect.any(String),
					currentPage: "1",
					end_date: "",
					is_add: "0",
					pageSize: "15",
					searchDepartment: "",
					searchValue: "",
					select_all: "false",
					select_notice: "",
					start_date: "",
					state: "",
					system_show: "1",
					total: "-1",
					totalCounts: "0",
					type: "",
				},
				path: "/comsys-portal-notice-web/getNoticeSlects",
			},
			{
				form: {
					comsys_random_t: expect.any(String),
				},
				path: "/comsys-prompt-portlet-web/getExplainDepts",
			},
			{
				form: {
					comsys_random_t: expect.any(String),
					name: "",
				},
				path: "/comsys-prompt-portlet-web/getFileFileType",
			},
		]);
	});
});
