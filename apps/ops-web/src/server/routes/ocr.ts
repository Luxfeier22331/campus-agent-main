import {
	createOcrObjects,
	createOcrTaskStore,
	type OcrTask,
	resolveOcrConfig,
} from "@campus-agent/document-ocr";
import { listNoticeSourceResources } from "@campus-agent/notices";
import type { Hono } from "hono";
import type { Pool } from "pg";
import { z } from "zod";
import portal from "../../../../../configs/sources/internal-portal.json" with { type: "json" };
import { NoticeOcrSchema } from "../../shared/ocr-contract.ts";
import { launchOcrJob } from "../ocr-jobs.ts";
import { ocrMarkdownForBrowser } from "../ocr-results.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import type { createProviderConfigAdminClient } from "../provider-config-client.ts";
import {
	admitOpsApiRequest,
	jsonError,
	readBoundedJson,
	requestHasConfiguredOrigin,
} from "./http.ts";

export function registerOcrRoutes(input: {
	app: Hono;
	admission: OpsAdmission;
	publicOrigin: string | null;
	pool?: Pool | undefined;
	env: NodeJS.ProcessEnv;
	providerConfigClient: ReturnType<typeof createProviderConfigAdminClient>;
}) {
	const { app, admission, publicOrigin, pool, env, providerConfigClient } = input;
	for (const path of [
		"/api/ops/ocr/*",
		"/api/ops/model-configs/document_ocr",
		"/api/ops/model-configs/document_ocr/validate",
	]) {
		app.use(path, async (c, next) => {
			const operator = await admitOpsApiRequest(admission, c.req.raw);
			if (operator instanceof Response) {
				return operator;
			}
			if (c.req.method !== "GET" && !requestHasConfiguredOrigin(c.req.raw, publicOrigin)) {
				return jsonError("OPS_OCR_CSRF", "请求未通过同源校验。", 403);
			}
			c.header("Cache-Control", "no-store");
			await next();
			return;
		});
	}
	const store = () => {
		if (!pool) {
			throw new Error("OCR database unavailable");
		}
		return createOcrTaskStore(pool);
	};
	const config = () => resolveOcrConfig(env.MODEL_CONFIG_URL || "http://model-config:8000");
	async function launch() {
		try {
			await launchOcrJob(env);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}
	app.get("/api/ops/model-configs/document_ocr", async (c) =>
		c.json(await providerConfigClient.getOcrConfig()),
	);
	app.put("/api/ops/model-configs/document_ocr", async (c) => {
		const body = z
			.object({ baseUrl: z.url(), apiKey: z.string().trim().min(1).optional() })
			.strict()
			.safeParse(await readBoundedJson(c.req.raw, 20 * 1024));
		if (!body.success) {
			return jsonError("OPS_OCR_INVALID", "请填写有效的服务地址和密钥。", 400);
		}
		const operator = await admitOpsApiRequest(admission, c.req.raw);
		if (operator instanceof Response) {
			return operator;
		}
		return c.json(await providerConfigClient.putOcrConfig(body.data, operator.operatorId));
	});
	app.post("/api/ops/model-configs/document_ocr/validate", async (c) => {
		const task = await store().create({ kind: "validation" }, await config());
		return c.json({ task, launchError: await launch() }, 202);
	});
	app.get("/api/ops/ocr/tasks", async (c) => c.json({ tasks: await store().list() }));
	app.get("/api/ops/ocr/notices/:noticeId", async (c) => {
		const noticeId = c.req.param("noticeId");
		if (!/^[1-9]\d*$/.test(noticeId)) {
			return jsonError("OPS_OCR_INVALID", "通知 ID 无效。", 400);
		}
		if (!pool) {
			throw new Error("OCR database unavailable");
		}
		const found = await pool.query("select notice_id from notices.notices where notice_id=$1", [
			noticeId,
		]);
		if (found.rows.length === 0) {
			return jsonError("OPS_OCR_NOT_FOUND", "通知不存在。", 404);
		}
		const objects = createOcrObjects(env);
		try {
			const source = JSON.parse(
				new TextDecoder().decode(
					await objects.getSource(`internal_portal/notices/${noticeId}.json`),
				),
			);
			const tasks = await store().listNotice(noticeId);
			const resources = listNoticeSourceResources(
				noticeId,
				source,
				new URL(portal.portal_base_url).hostname,
			)
				.filter((resource) => resource.kind === "image")
				.map((resource, displayOrdinal) => {
					const batches = tasks.filter(
						(task) => task.input.kind === "source" && task.input.key === resource.sourceKey,
					);
					return {
						sourceKey: resource.sourceKey,
						kind: resource.kind,
						ordinal: resource.ordinal,
						displayOrdinal,
						label: `图片${displayOrdinal + 1}`,
						selectedResultId:
							batches.find((task) => task.status === "completed" && task.result)?.id ?? null,
						batches: batches.map((task) => ({
							id: task.id,
							status: task.status,
							createdAt: task.createdAt,
							pageCount: task.pageCount,
							missingImageCount: task.result?.missingImages.length ?? 0,
							error: task.error,
							hasResult: task.status === "completed" && task.result !== null,
						})),
					};
				});
			return c.json(NoticeOcrSchema.parse({ noticeId, resources }));
		} finally {
			objects.close();
		}
	});
	app.get("/api/ops/ocr/tasks/:id", async (c) => {
		if (!z.uuid().safeParse(c.req.param("id")).success) {
			return jsonError("OPS_OCR_INVALID", "任务 ID 无效。", 400);
		}
		const task = await store().get(c.req.param("id"));
		return task ? c.json({ task }) : jsonError("OPS_OCR_NOT_FOUND", "识别任务不存在。", 404);
	});
	app.post("/api/ops/ocr/tasks", async (c) => {
		const body = z
			.object({
				noticeId: z.string().regex(/^[1-9]\d*$/),
				imageOrdinal: z.number().int().nonnegative().optional(),
			})
			.strict()
			.safeParse(await readBoundedJson(c.req.raw, 4096));
		if (!body.success) {
			return jsonError("OPS_OCR_INVALID", "请填写通知 ID。", 400);
		}
		const objects = createOcrObjects(env);
		try {
			const source = JSON.parse(
				new TextDecoder().decode(
					await objects.getSource(`internal_portal/notices/${body.data.noticeId}.json`),
				),
			);
			const inputs = listNoticeSourceResources(
				body.data.noticeId,
				source,
				new URL(portal.portal_base_url).hostname,
			)
				.filter((resource) => resource.kind === "image")
				.map((resource, displayOrdinal) => ({
					kind: "source" as const,
					noticeId: resource.noticeId,
					key: resource.sourceKey,
					contentType: "image/*",
					resource: { kind: resource.kind, ordinal: resource.ordinal, displayOrdinal },
				}))
				.filter(
					(input) =>
						body.data.imageOrdinal === undefined ||
						input.resource.displayOrdinal === body.data.imageOrdinal,
				);
			if (body.data.imageOrdinal !== undefined && inputs.length === 0) {
				return jsonError("OPS_OCR_NOT_FOUND", "正文图片不存在。", 404);
			}
			const runtime = await config();
			const tasks: OcrTask[] = [];
			for (const resource of inputs) {
				tasks.push(await store().create(resource, runtime));
			}
			return c.json({ tasks, launchError: inputs.length > 0 ? await launch() : null }, 202);
		} finally {
			objects.close();
		}
	});
	for (const action of ["resume", "rerun"] as const) {
		app.post(`/api/ops/ocr/tasks/:id/${action}`, async (c) => {
			if (!z.uuid().safeParse(c.req.param("id")).success) {
				return jsonError("OPS_OCR_INVALID", "任务 ID 无效。", 400);
			}
			const task = await store().get(c.req.param("id"));
			if (!task) {
				return jsonError("OPS_OCR_NOT_FOUND", "识别任务不存在。", 404);
			}
			if (action === "rerun") {
				if (task.status !== "failed" && task.status !== "completed") {
					return jsonError("OPS_OCR_ACTIVE", "任务仍在运行，请先恢复现有任务。", 409);
				}
				const next = await store().create(task.input, await config(), true);
				return c.json({ task: next, launchError: await launch() }, 202);
			}
			if (task.status === "failed") {
				if (!task.providerJobId) {
					return jsonError(
						"OPS_OCR_UNKNOWN_SUBMISSION",
						"没有可恢复的供应商任务 ID；确认后重新识别。",
						409,
					);
				}
				task.status = "submitted";
				task.error = null;
				await store().save(task);
			}
			return c.json({ task, launchError: await launch() }, 202);
		});
	}
	app.get("/api/ops/ocr/tasks/:id/result", async (c) => {
		if (!z.uuid().safeParse(c.req.param("id")).success) {
			return jsonError("OPS_OCR_INVALID", "任务 ID 无效。", 400);
		}
		const task = await store().get(c.req.param("id"));
		if (!task?.result) {
			return jsonError("OPS_OCR_NOT_READY", "识别结果尚未保存。", 404);
		}
		const pages = await store().getPages(task.id);
		return c.json({
			pages: pages.map((page) => ({
				index: page.index,
				markdown: ocrMarkdownForBrowser(task.id, page.markdown, page.images),
			})),
			missingImages: task.result.missingImages,
		});
	});
	app.get("/api/ops/ocr/tasks/:id/images/:name", async (c) => {
		if (!z.uuid().safeParse(c.req.param("id")).success) {
			return jsonError("OPS_OCR_INVALID", "任务 ID 无效。", 400);
		}
		const task = await store().get(c.req.param("id"));
		const pages = task ? await store().getPages(task.id) : [];
		const key = pages
			.flatMap((p) => p.images)
			.find((key) => key.split("/").at(-1) === c.req.param("name"));
		if (!key) {
			return jsonError("OPS_OCR_NOT_FOUND", "图片不存在。", 404);
		}
		const objects = createOcrObjects(env);
		try {
			const bytes = await objects.getDerived(key);
			const contentType = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
			return new Response(Buffer.from(bytes), {
				headers: {
					"content-type": contentType,
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
				},
			});
		} finally {
			objects.close();
		}
	});
}
