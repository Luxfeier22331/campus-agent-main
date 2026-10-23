import { isDeepStrictEqual } from "node:util";
import { type InternalPortalMeta, validateInternalPortalMeta } from "ingestion-contracts";

import type { InternalPortalCollectionObjectStore } from "../../../src/object-store.js";

export interface InternalPortalNoticeMetaStore {
	putMappings(input: {
		noticeTypes: Record<string, string>;
		organizations: Record<string, string>;
		updatedAt: string;
	}): Promise<"reused" | "written">;
}

export function createInternalPortalNoticeMetaStore(input: {
	objectStore: InternalPortalCollectionObjectStore;
}): InternalPortalNoticeMetaStore {
	return {
		async putMappings(mappings) {
			const existingBytes = await input.objectStore.getObjectIfExists({
				bucket: input.objectStore.sourceBucket,
				key: internalPortalNoticeMetaObjectKey(),
			});
			let noticeTypes = mappings.noticeTypes;
			let organizations = mappings.organizations;
			if (existingBytes) {
				const existing = parseStoredMeta(existingBytes);
				noticeTypes = { ...existing.notice_types, ...noticeTypes };
				organizations = { ...existing.organizations, ...organizations };
				if (
					isDeepStrictEqual(existing.notice_types, noticeTypes) &&
					isDeepStrictEqual(existing.organizations, organizations)
				) {
					return "reused";
				}
			}
			const meta: InternalPortalMeta = {
				notice_types: noticeTypes,
				organizations,
				schema_version: "internal_portal_meta.v1",
				updated_at: mappings.updatedAt,
			};
			const validation = validateInternalPortalMeta(meta);
			if (!validation.ok) {
				throw new Error(`internal portal metadata is invalid: ${validation.errors.join("; ")}`);
			}
			await input.objectStore.putObject({
				body: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, "utf-8"),
				bucket: input.objectStore.sourceBucket,
				contentType: "application/json",
				key: internalPortalNoticeMetaObjectKey(),
			});
			return "written";
		},
	};
}

export function internalPortalNoticeMetaObjectKey(): string {
	return "internal_portal/meta.json";
}

function parseStoredMeta(bytes: Uint8Array): InternalPortalMeta {
	let value: unknown;
	try {
		value = JSON.parse(Buffer.from(bytes).toString("utf-8"));
	} catch (error) {
		throw new Error("internal portal metadata is not valid JSON", { cause: error });
	}
	const validation = validateInternalPortalMeta(value);
	if (!validation.ok) {
		throw new Error(`internal portal metadata is invalid: ${validation.errors.join("; ")}`);
	}
	return value as InternalPortalMeta;
}
