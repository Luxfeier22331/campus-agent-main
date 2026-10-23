import { createHash } from "node:crypto";
import { normalizeNoticeContent } from "@campus-agent/notices";
import type {
	InternalPortalNoticeResource,
	InternalPortalNoticeSource,
} from "ingestion-contracts";
import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.ts";
import { createInternalPortalNoticeSourceStore } from "./notice-source.ts";
import { createNoticeInventoryStore } from "./notice-inventory-store.ts";
import type { PoolClient } from "pg";

/** Offline migration: no portal requests, no guessing that an existing projection matches. */
export async function migrateNoticeSources(input: {
 client: PoolClient;
 objectStore: InternalPortalCollectionObjectStore;
 portalHost: string;
}) {
	const sources = createInternalPortalNoticeSourceStore({ objectStore: input.objectStore });
	const inventory = createNoticeInventoryStore(input.client);
	const rows = await input.client.query(
		"SELECT notice_id FROM notices.notices WHERE source_ref IS NULL ORDER BY notice_id",
	);
	let migrated = 0;
	let missing = 0;
	for (const row of rows.rows) {
		const source = await sources.get(Number(row.notice_id));
		if (!source) {
			missing += 1;
			continue;
		}
		const resources: InternalPortalNoticeResource[] = [];
		const candidates = source.is_external
			? []
			: [
					...normalizeNoticeContent({
						html: source.notice_content_html,
						title: source.notice_title,
						portalHost: input.portalHost,
					}).images.map((image) => ({ kind: "images" as const, ordinal: image.sourceOrdinal })),
					...source.attachments.map((_, ordinal) => ({ kind: "attachments" as const, ordinal })),
				];
		for (const candidate of candidates) {
			const old = source.resources?.find(
				(ref) => ref.kind === candidate.kind && ref.ordinal === candidate.ordinal,
			);
			if (source.resources && old) {
				resources.push(old);
				continue;
			}
			const body = await input.objectStore.getObjectIfExists({
				bucket: input.objectStore.sourceBucket,
				key: `internal_portal/notices/${source.notice_id}/${candidate.kind}/${candidate.ordinal}`,
			});
			if (!body) {
				if (candidate.kind === "images") {
					throw new Error(`missing source image: ${source.notice_id}/${candidate.ordinal}`);
				}
				resources.push({
					...candidate,
					object_key: null,
					sha256: null,
					byte_size: null,
					content_type: null,
				});
				continue;
			}
			const sha256 = createHash("sha256").update(body).digest("hex");
			const key = `internal_portal/resources/sha256/${sha256}`;
			await input.objectStore.createObject({
				bucket: input.objectStore.sourceBucket,
				key,
				body,
				contentType: "application/octet-stream",
			});
			resources.push({
				...candidate,
				object_key: key,
				sha256,
				byte_size: body.byteLength,
				content_type: "application/octet-stream",
			});
		}
		const snapshot: InternalPortalNoticeSource = { ...source, resources };
		await sources.put(snapshot);
		await inventory.register(snapshot);
		migrated += 1;
	}
	return { migrated, missing };
}
