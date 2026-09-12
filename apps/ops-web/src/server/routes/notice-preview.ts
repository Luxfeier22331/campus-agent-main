import type { Hono } from "hono";
import { NoticePreviewSchema } from "../../shared/notice-preview-contract.ts";
import {
	type NoticePreviewStore,
	prepareNoticePreview,
	readNoticeSource,
} from "../notice-preview.ts";
import type { NoticeStore } from "../notice-store.ts";
import type { OpsAdmission } from "../ops-admission.ts";
import { admitOpsApiRequest, jsonError } from "./http.ts";

export function registerNoticePreviewRoutes(input: {
	app: Hono;
	admission: OpsAdmission;
	store: NoticeStore;
	source: NoticePreviewStore;
}) {
	for (const kind of ["preview", "images", "attachments"] as const) {
		const path = `/api/ops/notices/:noticeId/${kind}${kind === "preview" ? "" : "/:ordinal"}`;
		input.app.get(path, async (c) => {
			const operator = await admitOpsApiRequest(input.admission, c.req.raw);
			if (operator instanceof Response) {
				return operator;
			}
			c.header("Cache-Control", "private, no-store");
			const id = c.req.param("noticeId") ?? "";
			const noticeId = Number(id);
			if (!(/^[1-9][0-9]*$/u.test(id) && Number.isSafeInteger(noticeId))) {
				return jsonError("OPS_NOTICE_ID_INVALID", "通知 ID 无效。", 400);
			}
			const ordinalText = c.req.param("ordinal") ?? "0";
			const ordinal = Number(ordinalText);
			if (!(/^(0|[1-9][0-9]*)$/u.test(ordinalText) && Number.isSafeInteger(ordinal))) {
				return jsonError("OPS_NOTICE_RESOURCE_INVALID", "资源序号无效。", 400);
			}
			if (!(await input.store.get(noticeId))) {
				return jsonError("OPS_NOTICE_NOT_FOUND", "通知不存在。", 404);
			}
			const source = await readNoticeSource(input.source, noticeId);
			const { preview, images } = prepareNoticePreview(source);
			if (kind === "preview") {
				return c.json(NoticePreviewSchema.parse(preview));
			}
			const image = kind === "images" ? images.find((item) => item.ordinal === ordinal) : undefined;
			const attachment =
				kind === "attachments"
					? preview.attachments.find((item) => item.ordinal === ordinal)
					: undefined;
			if (!(image || attachment)) {
				return jsonError("OPS_NOTICE_RESOURCE_NOT_FOUND", "通知中没有该资源。", 404);
			}
			const object = await input.source.get(
				`internal_portal/notices/${noticeId}/${kind}/${image?.sourceOrdinal ?? ordinal}`,
			);
			const mime =
				object.contentType.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
			const inline = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf)$/u.test(mime);
			const name = attachment?.name || `${kind === "images" ? "图片" : "附件"} ${ordinal + 1}`;
			const encodedName = encodeURIComponent(name).replace(
				/[!'()*]/g,
				(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
			);
			c.header("Content-Type", inline ? mime : "application/octet-stream");
			c.header(
				"Content-Disposition",
				`${inline ? "inline" : "attachment"}; filename="resource"; filename*=UTF-8''${encodedName}`,
			);
			c.header("X-Content-Type-Options", "nosniff");
			return new Response(object.body, { headers: c.res.headers });
		});
	}
}
