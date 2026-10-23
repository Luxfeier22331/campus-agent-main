// @vitest-environment node

import type { NoticeDetailResponse, NoticeListResponse } from "campus-contracts/notices";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { NoticeService } from "../src/modules/notices";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	APP_API_DB: { connectionString: "postgres://postgres:secret@example.com:5432/campus_agent" },
};

const detail: NoticeDetailResponse = {
	attachments: [
		{
			byteSize: "1200",
			contentType: "application/pdf",
			downloadUrl:
				"https://my.muc.edu.cn/comsys-portal-notice-web/download?id=annex-1&notice_id=358159",
			name: "开放安排.pdf",
			ordinal: 0,
		},
	],
	contentHtml: '<p>正文<img src="notice-asset:image:0" alt=""></p>',
	category: "campus_operations",
	externalUrl: null,
	images: [
		{
			byteSize: "256",
			contentType: "image/png",
			name: null,
			ordinal: 0,
			url: "/api/notices/358159/images/0",
		},
	],
	isExternal: false,
	noticeId: "358159",
	noticeType: { id: 5, name: "办公通知" },
	organization: { id: "100", name: "图书馆" },
	releasedAt: "2026-08-11T00:00:00.000Z",
	title: "关于暂停开放的通知",
};

const list: NoticeListResponse = {
	filters: {
		categories: [{ label: "校园服务与运行", value: "campus_operations" }],
		noticeTypes: [{ label: "办公通知", value: 5 }],
		organizations: [{ label: "图书馆", value: "100" }],
	},
	items: [
		{
			category: detail.category,
			externalUrl: null,
			isExternal: false,
			noticeId: detail.noticeId,
			noticeType: detail.noticeType,
			organization: detail.organization,
			releasedAt: detail.releasedAt,
			title: detail.title,
		},
	],
	pagination: { page: 1, pageSize: 30, totalItems: 1, totalPages: 1 },
};

function principal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "user_1",
			principalType: "campus_member",
			roles: ["campus_member"],
			userId: "user_1",
		},
		permissions: { chat: true },
		principal: {
			displayName: "张同学",
			email: "student@muc.edu.cn",
			principalId: "user_1",
			type: "campus_member",
		},
		session: { expiresAt: "2026-08-14T08:00:00.000Z", sessionId: "session_1" },
	};
}

function service(): NoticeService {
	return {
		getDetail: vi.fn(async () => detail),
		list: vi.fn(async () => list),
		readImage: vi.fn(async () => ({
			body: new Response(new Uint8Array([137, 80, 78, 71])).body as ReadableStream<Uint8Array>,
			contentType: "image/png",
		})),
	};
}

describe("notice routes", () => {
	it("requires an authenticated session on every notice route", async () => {
		const app = createApp(env, {
			getPrincipal: vi.fn(async () => null),
			noticeService: service(),
		});

		for (const path of ["/api/notices", "/api/notices/358159", "/api/notices/358159/images/0"]) {
			const response = await app.fetch(new Request(`https://app-api.internal${path}`));
			expect(response.status, path).toBe(401);
			expect(response.headers.get("cache-control"), path).toBe("no-store");
		}
	});

	it("validates list filters and passes the normalized query to the service", async () => {
		const noticeService = service();
		const app = createApp(env, {
			getPrincipal: vi.fn(async () => principal()),
			noticeService,
		});
		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/notices?q=%E6%9A%82%E5%81%9C&category=campus_operations&stream=notices&notice_type=5&organization_id=100&is_external=false&from=2026-08-01&to=2026-08-13&page=2",
			),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual(list);
		expect(noticeService.list).toHaveBeenCalledWith({
			category: "campus_operations",
			from: "2026-08-01",
			is_external: false,
			notice_type: 5,
			organization_id: "100",
			page: 2,
			q: "暂停",
			stream: "notices",
			to: "2026-08-13",
		});
	});

	it("rejects unknown, repeated-shape and invalid list parameters", async () => {
		const noticeService = service();
		const app = createApp(env, {
			getPrincipal: vi.fn(async () => principal()),
			noticeService,
		});

		for (const query of [
			"category=unknown",
			"stream=unknown",
			"stream=campus_news&category=procurement",
			"from=2026-08-13&to=2026-08-01",
			"page=0",
			"notice_type=-1",
			"unknown=value",
		]) {
			const response = await app.fetch(
				new Request(`https://app-api.internal/api/notices?${query}`),
			);
			expect(response.status, query).toBe(400);
		}
		expect(noticeService.list).not.toHaveBeenCalled();
	});

	it("returns an internal detail without exposing storage identities", async () => {
		const noticeService = service();
		const app = createApp(env, {
			getPrincipal: vi.fn(async () => principal()),
			noticeService,
		});
		const response = await app.fetch(new Request("https://app-api.internal/api/notices/358159"));
		const payload = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(payload).toEqual(detail);
		expect(JSON.stringify(payload)).not.toContain("contentSha256");
		expect(JSON.stringify(payload)).not.toContain("contentText");
		expect(noticeService.getDetail).toHaveBeenCalledWith("358159");
	});

	it("streams an owned image with private response headers", async () => {
		const noticeService = service();
		const app = createApp(env, {
			getPrincipal: vi.fn(async () => principal()),
			noticeService,
		});
		const response = await app.fetch(
			new Request("https://app-api.internal/api/notices/358159/images/0"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("content-security-policy")).toContain("sandbox");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
		expect(noticeService.readImage).toHaveBeenCalledWith("358159", 0);
	});

	it("rejects malformed notice ids and image ordinals before calling the service", async () => {
		const noticeService = service();
		const app = createApp(env, {
			getPrincipal: vi.fn(async () => principal()),
			noticeService,
		});

		for (const path of [
			"/api/notices/0",
			"/api/notices/not-a-number",
			"/api/notices/1/images/-1",
		]) {
			const response = await app.fetch(new Request(`https://app-api.internal${path}`));
			expect(response.status, path).toBe(400);
		}
		expect(noticeService.getDetail).not.toHaveBeenCalled();
		expect(noticeService.readImage).not.toHaveBeenCalled();
	});
});
