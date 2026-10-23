import { createHash } from "node:crypto";
import type { InternalPortalNoticeResource, InternalPortalNoticeSource } from "./index.ts";

export function noticeSourceRef(
	source: InternalPortalNoticeSource,
	resources: readonly InternalPortalNoticeResource[] = source.resources ?? [],
): string {
	const payload = {
		...source,
		resources: [...resources].sort((left, right) =>
			left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : left.ordinal - right.ordinal,
		),
	};
	return `internal_portal/notices/${source.notice_id}/sources/${createHash("sha256").update(canonicalJson(payload)).digest("hex")}.json`;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map(
				(key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}
