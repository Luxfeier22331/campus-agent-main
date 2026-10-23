import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/config";
import { AppApiRouteError } from "../src/http";
import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { AuthDependencyFailure } from "../src/modules/auth/dependency-failure";
import type { DiningSubmissionService } from "../src/modules/dining";

const env: Env = { DEPLOYMENT_ENVIRONMENT: "test", AUTH_SHELL_ORIGIN: "https://campus.muc.wiki" };
const owner = {
	submissionId: "submission_1",
	windowId: "hall:floor:window",
	name: "面",
	priceText: null,
	status: "public" as const,
	photo: null,
	revision: 2,
	canEdit: true,
	canDelete: true,
	createdAt: "2026-09-14T00:00:00.000Z",
	updatedAt: "2026-09-14T00:00:00.000Z",
	deletedAt: null,
	hiddenAt: null,
	expiresAt: null,
	windowAvailable: true,
};
const publicSubmission = {
	submissionId: owner.submissionId,
	windowId: owner.windowId,
	name: owner.name,
	priceText: null,
	photo: null,
	source: "user_submission" as const,
	authorName: "同学",
	createdAt: owner.createdAt,
	updatedAt: owner.updatedAt,
	canReport: true,
	hasReported: false,
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
			displayName: "同学",
			email: "student@muc.edu.cn",
			principalId: "user_1",
			type: "campus_member",
		},
		session: { expiresAt: "2026-09-15T00:00:00.000Z", sessionId: "session_1" },
	};
}
function setup(loggedIn = true) {
	const service: DiningSubmissionService = {
		create: vi.fn(async () => ({ submission: owner })),
		update: vi.fn(async () => ({ submission: owner })),
		deleteOwn: vi.fn(async () => undefined),
		listPublic: vi.fn(async () => ({ items: [publicSubmission], nextCursor: null })),
		getPublic: vi.fn(async () => ({ submission: publicSubmission })),
		listOwn: vi.fn(async () => ({ items: [owner], nextCursor: null })),
		getOwn: vi.fn(async () => ({ submission: owner })),
		getPhoto: vi.fn(
			async () =>
				({ bytes: new Uint8Array([1, 2, 3]), etag: '"photo_1"', notModified: false }) as const,
		),
	};
	const getPrincipal = vi.fn(async () => (loggedIn ? principal() : null));
	const app = createApp(env, { diningSubmissionService: service, getPrincipal });
	return { app, service, getPrincipal };
}
const base = "https://app-api.internal/api/dining";
const createPath = `${base}/windows/hall:floor:window/submissions`;
const ownPath = `${base}/me/submissions/submission_1`;
function jsonRequest(body: unknown, method = "POST", headers: Record<string, string> = {}) {
	return new Request(method === "POST" ? createPath : ownPath, {
		method,
		headers: {
			"content-type": "application/json",
			"idempotency-key": "submission-key-1",
			"if-match": '"2"',
			...headers,
		},
		body: JSON.stringify(body),
	});
}
// biome-ignore-start lint/suspicious/noMisplacedAssertion: Shared assertion helper awaited by test cases.
async function expectError(response: Response, status: number, code: string) {
	expect(response.status).toBe(status);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(await response.json()).toMatchObject({ error: { code } });
}
// biome-ignore-end lint/suspicious/noMisplacedAssertion: Shared assertion helper.
function formRequest(action = "replace", file = new Uint8Array([1, 2, 3])) {
	const form = new FormData();
	form.append("metadata", JSON.stringify({ name: " 面 ", priceText: null, photoAction: action }));
	form.append(
		"photo",
		new Blob([new Uint8Array(file)], { type: "application/octet-stream" }),
		"anything.bin",
	);
	return form;
}
function upload(form: FormData) {
	return new Request(createPath, {
		method: "POST",
		headers: { "idempotency-key": "submission-key-1" },
		body: form,
	});
}

describe("Dining submission HTTP", () => {
	it("reports authentication dependency failures before accessing public or owner submissions", async () => {
		const { app, service, getPrincipal } = setup();
		getPrincipal.mockRejectedValue(new AuthDependencyFailure());
		for (const request of [
			new Request(createPath),
			new Request(`${base}/submissions/submission_1`),
			new Request(ownPath),
			jsonRequest({ name: "面", priceText: null, photoAction: "none" }),
		]) {
			await expectError(await app.fetch(request), 503, "dependency_not_ready");
		}
		for (const fn of Object.values(service)) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it("authenticates owner paths before reading a body or accessing the service", async () => {
		const { app, service } = setup(false);
		for (const request of [
			jsonRequest({}),
			new Request(ownPath),
			new Request(`${ownPath}/photos/photo_1`),
			new Request(ownPath, { method: "DELETE" }),
		]) {
			const response = await app.fetch(request);
			expect(response.status).toBe(401);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
		for (const fn of Object.values(service)) {
			expect(fn).not.toHaveBeenCalled();
		}
	});

	it("creates normalized text with authenticated identity and a strong owner ETag", async () => {
		const { app, service } = setup();
		const response = await app.fetch(
			jsonRequest({ name: " 面 ", priceText: null, photoAction: "none" }),
		);
		expect(response.status).toBe(201);
		expect(response.headers.get("etag")).toBe('"2"');
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(service.create).toHaveBeenCalledWith(
			expect.objectContaining({
				actor: expect.objectContaining({ principalId: "user_1", displayName: "同学" }),
				windowId: "hall:floor:window",
				idempotencyKey: "submission-key-1",
				metadata: { name: "面", priceText: null, photoAction: "none" },
				photo: null,
			}),
		);
	});

	it.each([
		{ name: "面", priceText: null },
		{ name: "面", photoAction: "none" },
		{ name: "面", priceText: null, photoAction: "replace" },
		{ name: "面", priceText: null, photoAction: "none", authorId: "other" },
		{ name: "面", priceText: null, photoAction: "none", revision: 5 },
	])("rejects invalid create metadata %j", async (body) => {
		const { app, service } = setup();
		await expectError(await app.fetch(jsonRequest(body)), 400, "dining_submission_request_invalid");
		expect(service.create).not.toHaveBeenCalled();
	});

	it.each(["", "short", "a".repeat(201)])("rejects an invalid idempotency key", async (key) => {
		const { app } = setup();
		await expectError(
			await app.fetch(
				jsonRequest({ name: "面", priceText: null, photoAction: "none" }, "POST", {
					"idempotency-key": key,
				}),
			),
			400,
			"idempotency_key_invalid",
		);
	});

	it("passes original file bytes regardless of filename or claimed MIME", async () => {
		const { app, service } = setup();
		expect((await app.fetch(upload(formRequest()))).status).toBe(201);
		expect(service.create).toHaveBeenCalledWith(
			expect.objectContaining({
				photo: new Uint8Array([1, 2, 3]),
				metadata: { name: "面", priceText: null, photoAction: "replace" },
			}),
		);
	});

	it.each(["duplicate", "unknown", "url", "empty", "action", "metadata-file"])(
		"rejects invalid multipart: %s",
		async (kind) => {
			const { app, service } = setup();
			const form = formRequest();
			if (kind === "duplicate") {
				form.append("photo", new Blob(["extra"]), "extra.png");
			}
			if (kind === "unknown") {
				form.append("authorId", "other");
			}
			if (kind === "url") {
				form.set("photo", "https://external/photo.png");
			}
			if (kind === "empty") {
				form.set("photo", new Blob([]), "empty.png");
			}
			if (kind === "action") {
				form.set("metadata", JSON.stringify({ name: "面", priceText: null, photoAction: "none" }));
			}
			if (kind === "metadata-file") {
				form.set("metadata", new Blob(["{}"]), "metadata.json");
			}
			await expectError(await app.fetch(upload(form)), 400, "dining_submission_request_invalid");
			expect(service.create).not.toHaveBeenCalled();
		},
	);

	it("enforces metadata bytes independently from full multipart size", async () => {
		const { app } = setup();
		const form = formRequest();
		form.set("metadata", "中".repeat(3000));
		await expectError(await app.fetch(upload(form)), 413, "dining_submission_payload_too_large");
	});

	it("enforces file size independently from multipart overhead", async () => {
		const { app } = setup();
		await expectError(
			await app.fetch(upload(formRequest("replace", new Uint8Array(10 * 1024 * 1024 + 1)))),
			413,
			"dining_submission_payload_too_large",
		);
	});

	it.each(["application/json", "multipart/form-data; boundary=test"])(
		"counts streaming bytes despite false Content-Length: %s",
		async (contentType) => {
			const { app, service } = setup();
			const cancel = vi.fn();
			const chunk = new Uint8Array(
				contentType === "application/json" ? 8193 : 10 * 1024 * 1024 + 64 * 1024 + 1,
			);
			const body = new ReadableStream<Uint8Array>({
				pull(controller) {
					controller.enqueue(chunk);
				},
				cancel,
			});
			const request = new Request(createPath, {
				method: "POST",
				headers: {
					"content-type": contentType,
					"content-length": "1",
					"idempotency-key": "submission-key-1",
				},
				body,
				duplex: "half",
			} as RequestInit);
			await expectError(await app.fetch(request), 413, "dining_submission_payload_too_large");
			expect(cancel).toHaveBeenCalled();
			expect(service.create).not.toHaveBeenCalled();
		},
	);

	it("requires a single quoted safe positive revision before mutation", async () => {
		const { app, service } = setup();
		await expectError(
			await app.fetch(new Request(ownPath, { method: "DELETE" })),
			428,
			"dining_submission_revision_required",
		);
		for (const value of ["*", "2", 'W/"2"', '"0"', '"02"', '"2", "3"', '"9007199254740992"']) {
			await expectError(
				await app.fetch(new Request(ownPath, { method: "DELETE", headers: { "if-match": value } })),
				400,
				"dining_submission_request_invalid",
			);
		}
		expect(service.deleteOwn).not.toHaveBeenCalled();
		const response = await app.fetch(
			new Request(ownPath, { method: "DELETE", headers: { "if-match": '"2"' } }),
		);
		expect(response.status).toBe(204);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(service.deleteOwn).toHaveBeenCalledWith({
			expectedRevision: 2,
			submissionId: "submission_1",
			userId: "user_1",
		});
	});

	it("returns owner ETags and dispatches text edits with revision", async () => {
		const { app, service } = setup();
		for (const request of [
			new Request(ownPath),
			jsonRequest({ name: "面", priceText: null, photoAction: "remove" }, "PATCH"),
		]) {
			const response = await app.fetch(request);
			expect(response.status).toBe(200);
			expect(response.headers.get("etag")).toBe('"2"');
		}
		expect(service.update).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedRevision: 2,
				photo: null,
				metadata: { name: "面", priceText: null, photoAction: "remove" },
			}),
		);
	});

	it("separates owner/public photo reads and forwards conditional validators", async () => {
		const { app, service, getPrincipal } = setup();
		for (const [path, ownerUserId] of [
			[`${base}/submissions/submission_1/photos/photo_1`, null],
			[`${ownPath}/photos/photo_1`, "user_1"],
		] as const) {
			const response = await app.fetch(
				new Request(path, {
					headers: { "if-none-match": '"photo_1"', "if-modified-since": owner.createdAt },
				}),
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("image/webp");
			expect(response.headers.get("cache-control")).toBe("private, no-cache");
			expect(response.headers.get("etag")).toBe('"photo_1"');
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(service.getPhoto).toHaveBeenLastCalledWith({
				submissionId: "submission_1",
				photoId: "photo_1",
				ownerUserId,
				ifNoneMatch: '"photo_1"',
			});
		}
		expect(getPrincipal).toHaveBeenCalledTimes(1);
	});

	it("maps a matching photo validator to a bodyless 304 with revalidation policy", async () => {
		const { app, service } = setup();
		vi.mocked(service.getPhoto).mockResolvedValue({
			etag: '"photo_1"',
			notModified: true,
		});
		const response = await app.fetch(
			new Request(`${ownPath}/photos/photo_1`, { headers: { "if-none-match": '"photo_1"' } }),
		);
		expect(response.status).toBe(304);
		expect(response.headers.get("cache-control")).toBe("private, no-cache");
		expect(response.headers.get("etag")).toBe('"photo_1"');
		expect(response.body).toBeNull();
	});

	it("passes optional viewer and scoped list arguments", async () => {
		const { app, service } = setup(false);
		expect((await app.fetch(new Request(`${createPath}?limit=4&cursor=opaque`))).status).toBe(200);
		expect(service.listPublic).toHaveBeenCalledWith({
			windowId: "hall:floor:window",
			limit: 4,
			cursor: "opaque",
			viewerUserId: null,
		});
		expect((await app.fetch(new Request(`${base}/submissions/submission_1`))).status).toBe(200);
		expect(service.getPublic).toHaveBeenCalledWith({
			submissionId: "submission_1",
			viewerUserId: null,
		});
		const member = setup();
		expect((await member.app.fetch(new Request(`${base}/me/submissions`))).status).toBe(200);
		expect(member.service.listOwn).toHaveBeenCalledWith({ limit: 20, userId: "user_1" });
	});

	it.each(["limit=0", "limit=51", "limit=1e1", "limit=2&limit=3", "cursor=", "cursor=a&cursor=b"])(
		"rejects malformed pagination: %s",
		async (query) => {
			const { app } = setup();
			await expectError(
				await app.fetch(new Request(`${createPath}?${query}`)),
				400,
				"dining_submission_request_invalid",
			);
		},
	);

	it("preserves service failure classification without caching it", async () => {
		const { app, service } = setup();
		vi.mocked(service.getPhoto).mockRejectedValue(
			new AppApiRouteError({
				code: "dining_submission_photo_not_found",
				status: 404,
				retryable: false,
				message: "未找到照片。",
			}),
		);
		await expectError(
			await app.fetch(new Request(`${ownPath}/photos/photo_1`)),
			404,
			"dining_submission_photo_not_found",
		);
		vi.mocked(service.update).mockRejectedValue(
			new AppApiRouteError({
				code: "dining_submission_revision_conflict",
				status: 412,
				retryable: false,
				message: "版本冲突。",
			}),
		);
		await expectError(
			await app.fetch(jsonRequest({ name: "面", priceText: null, photoAction: "keep" }, "PATCH")),
			412,
			"dining_submission_revision_conflict",
		);
	});
});
