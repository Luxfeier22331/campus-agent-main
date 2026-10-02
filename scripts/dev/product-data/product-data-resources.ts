import { createHash } from "node:crypto";
import { compileDocsSource } from "../../../apps/campus-web/src/docs-reader-build/source-compiler.ts";
import type {
	ReaderObjectStore,
	UnifiedPoint,
	WritableObjectStore,
} from "../../../jobs/campus-rag-index-publisher/src/types.ts";
import {
	buildReaderRouteSlug,
	normalizeSourceManifest,
	parseSourceManifest,
} from "../../../packages/contracts/src/campus-docs/node/index.ts";
import type { ProductDataRows, RetrievalProductDataRows } from "./product-data-tables.ts";

export type ProductDocsReferences = Map<
	string,
	{ documentId: string; versionId: string; rootUnitIds: Set<string> }
>;

export interface ProductDocsClosure {
	sourceBytes: Uint8Array;
	references: ProductDocsReferences;
	manifest: ReturnType<typeof normalizeSourceManifest>;
	objects: Map<string, { contentType: string }>;
}

export const PRODUCT_DOCS_SOURCE_KEY = "campus-docs/source.json";

/** All versions, supplements and image objects reachable from the mutable source. */
export async function copyDocsClosure(
	source: ReaderObjectStore,
	target?: WritableObjectStore,
): Promise<ProductDocsClosure> {
	const sourceBytes = await source.read(PRODUCT_DOCS_SOURCE_KEY);
	const manifest = normalizeSourceManifest(
		parseSourceManifest(JSON.parse(Buffer.from(sourceBytes).toString("utf8"))),
	);
	const references: ProductDocsReferences = new Map();
	const objects = new Map<string, { contentType: string }>();
	const compiled = await compileDocsSource({
		source: manifest,
		client: { readOptionalBytesObject: async ({ key }) => source.read(key) },
	});
	for (const version of manifest.versions) {
		const reader = compiled.readers.get(version.versionId);
		if (!reader) {
			throw new Error(`Docs reader is missing: ${version.versionId}`);
		}
		const document = manifest.documents.find((item) => item.docId === version.docId);
		if (!document) {
			throw new Error(`Missing Docs document: ${version.docId}`);
		}
		const route = `/docs/${document.corpus}/${document.collection}/${buildReaderRouteSlug(document)}/v/${encodeURIComponent(version.versionSlug)}`;
		const reference = {
			documentId: version.docId,
			versionId: version.versionId,
			rootUnitIds: new Set(reader.elements.map((element) => element.rootUnitId)),
		};
		references.set(route, reference);
		for (const element of reader.elements) {
			if (element.kind === "heading") {
				references.set(`${route}#${encodeURIComponent(element.anchor)}`, reference);
			}
		}
		objects.set(version.reader.key, { contentType: "application/json" });
		for (const supplement of version.supplements) {
			objects.set(supplement.object.key, { contentType: "application/json" });
			for (const asset of supplement.assets) {
				objects.set(asset.object.key, { contentType: "image/png" });
			}
		}
	}
	for (const [key, object] of objects) {
		const prepared = compiled.objects.get(key);
		if (!prepared) {
			throw new Error(`Docs object is missing after compilation: ${key}`);
		}
		await target?.writeImmutable(key, prepared.bytes, object.contentType);
	}
	return { sourceBytes, references, manifest, objects };
}

export async function copyProductAssets(
	rows: ProductDataRows,
	source: ReaderObjectStore,
	target?: WritableObjectStore,
) {
	const refs = new Map<string, { sha256: string; contentType: string }>();
	for (const asset of rows["notices.notice_assets"]) {
		if (asset.asset_kind === "image") {
			refs.set(`notices/assets/sha256/${asset.content_sha256}`, {
				sha256: `sha256:${asset.content_sha256}`,
				contentType: String(asset.content_type),
			});
		}
	}
	for (const release of rows["dining.map_releases"]) {
		const payload = release.public_payload_json as {
			halls: Array<{ floors: Array<{ floorplan: { svgAssetUrl: string; sha256: string } }> }>;
		};
		for (const hall of payload.halls) {
			for (const floor of hall.floors) {
				const { sha256, svgAssetUrl } = floor.floorplan;
				const key = `dining/floorplans/${sha256.replace(/^sha256:/u, "")}.svg`;
				if (svgAssetUrl !== `/api/${key}`) {
					throw new Error("Dining floorplan URL does not match its digest");
				}
				refs.set(key, { sha256, contentType: "image/svg+xml" });
			}
		}
	}
	for (const [key, ref] of refs) {
		const bytes = await source.read(key);
		if (digest(bytes) !== ref.sha256) {
			throw new Error(`Product asset digest mismatch: ${key}`);
		}
		await target?.writeImmutable(key, bytes, ref.contentType);
	}
}

export async function copyNoticeAssets(
	rows: RetrievalProductDataRows,
	source: ReaderObjectStore,
	target?: WritableObjectStore,
) {
	for (const asset of rows["notices.notice_assets"]) {
		if (asset.asset_kind !== "image") {
			continue;
		}
		const sha256 = `sha256:${asset.content_sha256}`;
		const key = `notices/assets/sha256/${asset.content_sha256}`;
		const bytes = await source.read(key);
		if (digest(bytes) !== sha256) {
			throw new Error(`Product asset digest mismatch: ${key}`);
		}
		await target?.writeImmutable(key, bytes, String(asset.content_type));
	}
}

export function validateProductPoint(
	point: UnifiedPoint,
	rows: Pick<ProductDataRows, "notices.notices">,
	docsReferences: ProductDocsReferences,
): void {
	const payload = point.payload;
	if (!["campus_rag_point.v2", "campus_rag_point.v3"].includes(payload.schema_version)) {
		throw new Error(`Unsupported RAG point: ${point.id}`);
	}
	if (payload.source_kind === "notice") {
		const notice = rows["notices.notices"].find(
			(row) => String(row.notice_id) === String(payload.notice_id),
		);
		if (
			!notice?.is_published ||
			notice.is_external ||
			payload.citation_href !== `/notices/${payload.notice_id}`
		) {
			throw new Error(`RAG notice has no published local detail: ${payload.notice_id}`);
		}
	} else if (payload.source_kind === "document") {
		const reference = docsReferences.get(String(payload.section_ref));
		if (
			!reference ||
			reference.documentId !== payload.document_id ||
			reference.versionId !== payload.version_id ||
			payload.citation_href !== payload.section_ref ||
			!Array.isArray(payload.root_unit_ids) ||
			!payload.root_unit_ids.every((id: string) => reference.rootUnitIds.has(id))
		) {
			throw new Error(`RAG Docs reference does not resolve: ${payload.section_ref}`);
		}
	} else {
		throw new Error(`Unsupported RAG source: ${payload.source_kind}`);
	}
}

function digest(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
