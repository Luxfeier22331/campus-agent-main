import { createHash } from "node:crypto";
import { normalizeNoticeContent } from "@campus-agent/notices";
import {
	type InternalPortalNoticeSource,
	validateInternalPortalNoticeSource,
} from "ingestion-contracts";
import { noticeSourceRef } from "ingestion-contracts/notice-source-ref";
import portal from "../../../configs/sources/internal-portal.json" with { type: "json" };
import type { NoticeSourceRows } from "./notice-sync.ts";

/** Copy only the selected rows' current and published source closures before importing their refs. */
export async function copyNoticeSourceClosure(input: {
	rows: NoticeSourceRows;
	read: (key: string) => Promise<Uint8Array>;
	write: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
}) {
	let objects = 0;
	const copied = new Set<string>();
	const copy = async (key: string, contentType: string, sha256?: string | null) => {
		if (copied.has(key)) {
			return;
		}
		const body = await input.read(key);
		if (sha256 && createHash("sha256").update(body).digest("hex") !== sha256) {
			throw new Error(`Notice resource digest mismatch: ${key}`);
		}
		await input.write(key, body, contentType);
		copied.add(key);
		objects += 1;
	};
	if (input.rows["notices.notices"].length === 0) {
		return { objects };
	}
	await copy("internal_portal/meta.json", "application/json");
	for (const row of input.rows["notices.notices"]) {
		const refs = new Set(
			[row.source_ref ?? `internal_portal/notices/${row.notice_id}.json`, row.published_source_ref]
				.filter(Boolean)
				.map(String),
		);
		for (const key of refs) {
			const body = await input.read(key);
			const value = JSON.parse(Buffer.from(body).toString("utf8"));
			if (
				!validateInternalPortalNoticeSource(value).ok ||
				String(value.notice_id) !== String(row.notice_id)
			) {
				throw new Error(`Invalid notice source: ${key}`);
			}
			const source = value as InternalPortalNoticeSource;
			if (
				(key === row.source_ref || key === row.published_source_ref) &&
				noticeSourceRef(source) !== key
			) {
				throw new Error(`Notice source ref mismatch: ${key}`);
			}
			if (source.resources) {
				for (const resource of source.resources) {
					if (resource.object_key) {
						await copy(
							resource.object_key,
							resource.content_type ?? "application/octet-stream",
							resource.sha256,
						);
					}
				}
			} else if (!source.is_external) {
				const content = normalizeNoticeContent({
					html: source.notice_content_html,
					title: source.notice_title,
					portalHost: new URL(portal.portal_base_url).hostname,
				});
				for (const image of content.images) {
					await copy(
						`internal_portal/notices/${row.notice_id}/images/${image.sourceOrdinal}`,
						"application/octet-stream",
					);
				}
				for (const [ordinal] of source.attachments.entries()) {
					try {
						await copy(
							`internal_portal/notices/${row.notice_id}/attachments/${ordinal}`,
							"application/octet-stream",
						);
					} catch (error) {
						if (!(error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name))) {
							throw error;
						}
					}
				}
			}
			await input.write(key, body, "application/json");
			objects += 1;
		}
	}
	return { objects };
}
