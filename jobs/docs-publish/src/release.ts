import { createHash } from "node:crypto";

import type {
	DocsAppProjection,
	DocsReleaseManifest,
	DocsReleaseRef,
	ObjectRef,
} from "./types.ts";

const ALLOWED_SCOPES = new Set([
	"curriculum/curriculum_plan",
	"regulations/institutional_rules",
	"regulations/scoped_rules",
	"regulations/student_rules",
]);

export function canonicalJsonBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(sortJson(value), undefined, 2)}\n`);
}

export function sha256(value: Uint8Array): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function releaseManifestKey(releaseId: string): string {
	const digest = assertReleaseId(releaseId).slice("sha256:".length);
	return `docs-reader/releases/sha256/${digest}/manifest.json`;
}

export function projectionKey(digest: string): string {
	return `docs-reader/projections/sha256/${assertReleaseId(digest).slice("sha256:".length)}.json`;
}

export function assertReleaseId(value: string): `sha256:${string}` {
	if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new Error("docs release id must be sha256:<64 lowercase hex characters>");
	}
	return value as `sha256:${string}`;
}

export function normalizeProjection(value: DocsAppProjection): DocsAppProjection {
	if (value.schemaVersion !== "campus_docs_app_projection.v1") {
		throw new Error(`unsupported docs projection schema: ${String(value.schemaVersion)}`);
	}
	const projection: DocsAppProjection = {
		...value,
		collections: [...value.collections].sort((a, b) => scope(a).localeCompare(scope(b))),
		documents: [...value.documents].sort((a, b) =>
			`${scope(a)}/${a.documentSlug}`.localeCompare(`${scope(b)}/${b.documentSlug}`),
		),
		documentVersions: [...value.documentVersions].sort((a, b) =>
			`${a.docId}/${a.versionSlug}`.localeCompare(`${b.docId}/${b.versionSlug}`),
		),
		readerAssets: [...value.readerAssets].sort((a, b) => a.versionId.localeCompare(b.versionId)),
		searchUnits: [...value.searchUnits].sort((a, b) =>
			`${a.versionId}/${a.unitOrder}/${a.searchUnitId}`.localeCompare(
				`${b.versionId}/${b.unitOrder}/${b.searchUnitId}`,
			),
		),
	};
	assertProjectionRelationships(projection);
	return projection;
}

export function buildReleaseManifest(
	projection: DocsAppProjection,
	projectionRef: ObjectRef,
	sourceReleaseRefs: ObjectRef[],
): DocsReleaseManifest {
	const documents = new Map(projection.documents.map((item) => [item.docId, item]));
	const versions = new Map(
		projection.documentVersions.filter(isPublishedVersion).map((item) => [item.versionId, item]),
	);
	const currentVersions = new Map(
		projection.documentVersions
			.filter((item) => item.isCurrent && isPublishedVersion(item))
			.map((item) => [item.versionId, item]),
	);
	return {
		entries: projection.readerAssets
			.flatMap((asset) => {
				const version = versions.get(asset.versionId);
				const document = version ? documents.get(version.docId) : undefined;
				return version && document
					? [{
							collection: document.collection,
							corpus: document.corpus,
							deliveryMode: version.deliveryMode,
							docId: document.docId,
							documentSlug: document.documentSlug,
							isCurrent: version.isCurrent,
							sourceObjects: sortRecord(asset.sourceObjects),
							targetObjects: sortRecord(asset.targetObjects),
							title: document.title,
							versionId: version.versionId,
							versionLabel: version.label,
							versionSlug: version.versionSlug,
						}]
					: [];
			})
			.sort((a, b) => `${a.docId}:${a.versionId}`.localeCompare(`${b.docId}:${b.versionId}`)),
		projection: projectionRef,
		schemaVersion: "campus_docs_release_manifest.v1",
		searchUnits: projection.searchUnits
			.flatMap((unit) => {
				const version = currentVersions.get(unit.versionId);
				const document = version ? documents.get(version.docId) : undefined;
				return version && document
					? [{
							anchor: unit.anchor,
							canonicalUrl: document.canonicalUrl.split("#", 1)[0].split("?", 1)[0].replace(/\/$/u, ""),
							collection: document.collection,
							corpus: document.corpus,
							docId: document.docId,
							documentSlug: document.documentSlug,
							documentTitle: document.title,
							highlightRootUnitIds: [...unit.highlightRootUnitIds].sort(),
							searchUnitId: unit.searchUnitId,
							snippet: unit.snippet,
							title: unit.title,
							versionId: version.versionId,
							versionSlug: version.versionSlug,
						}]
					: [];
			})
			.sort((a, b) =>
				`${a.corpus}/${a.collection}/${a.documentSlug}/${a.anchor}/${a.searchUnitId}`.localeCompare(
					`${b.corpus}/${b.collection}/${b.documentSlug}/${b.anchor}/${b.searchUnitId}`,
				),
			),
		sourceReleaseRefs: [...sourceReleaseRefs].sort((a, b) => a.key.localeCompare(b.key)),
		surface: "campus_docs",
	};
}

export function releaseRefForManifest(bytes: Uint8Array): DocsReleaseRef {
	return { releaseId: sha256(bytes), schemaVersion: "campus_docs_release_ref.v1" };
}

function assertProjectionRelationships(projection: DocsAppProjection): void {
	const scopes = unique(projection.collections.map(scope), "collection scope");
	for (const value of scopes) {
		if (!ALLOWED_SCOPES.has(value)) throw new Error(`unsupported docs scope: ${value}`);
	}
	const documents = unique(projection.documents.map((item) => item.docId), "document id");
	unique(
		projection.documents.map((item) => `${scope(item)}/${item.documentSlug}`),
		"document scope slug",
	);
	const documentsById = new Map(projection.documents.map((item) => [item.docId, item]));
	const versions = unique(projection.documentVersions.map((item) => item.versionId), "version id");
	unique(
		projection.documentVersions.map((item) => `${item.docId}/${item.versionSlug}`),
		"document version slug",
	);
	const versionsById = new Map(projection.documentVersions.map((item) => [item.versionId, item]));
	unique(projection.readerAssets.map((item) => item.versionId), "reader asset version id");
	unique(projection.searchUnits.map((item) => item.searchUnitId), "search unit id");
	for (const document of projection.documents) {
		if (!scopes.has(scope(document))) {
			throw new Error(`document references missing scope: ${document.docId}`);
		}
		const currentVersion = versionsById.get(document.currentVersionId);
		if (!(currentVersion && currentVersion.docId === document.docId)) {
			throw new Error(`document current version is missing: ${document.docId}`);
		}
		if (!(currentVersion.isCurrent && currentVersion.versionSlug === document.currentVersionSlug)) {
			throw new Error(`document current version identity is inconsistent: ${document.docId}`);
		}
		if (
			projection.documentVersions.filter(
				(version) => version.docId === document.docId && version.isCurrent,
			).length !== 1
		) {
			throw new Error(`document must have exactly one current version: ${document.docId}`);
		}
	}
	for (const version of projection.documentVersions) {
		if (!documents.has(version.docId)) {
			throw new Error(`version references missing document: ${version.versionId}`);
		}
		if (!isPublishedVersion(version)) {
			throw new Error(`version has an unsupported publication policy: ${version.versionId}`);
		}
	}
	for (const asset of projection.readerAssets) {
		if (!versions.has(asset.versionId)) {
			throw new Error(`reader asset references missing version: ${asset.versionId}`);
		}
		if (!(hasReaderPackage(asset.sourceObjects) && hasReaderPackage(asset.targetObjects))) {
			throw new Error(
				`reader asset requires reader, outline, meta and asset-manifest objects: ${asset.versionId}`,
			);
		}
	}
	for (const version of projection.documentVersions) {
		if (!projection.readerAssets.some((asset) => asset.versionId === version.versionId)) {
			throw new Error(`published version is missing a reader asset: ${version.versionId}`);
		}
	}
	for (const unit of projection.searchUnits) {
		const version = versionsById.get(unit.versionId);
		if (!(documentsById.has(unit.docId) && version?.docId === unit.docId && version.isCurrent)) {
			throw new Error(`search unit references missing document or version: ${unit.searchUnitId}`);
		}
	}
}

function hasReaderPackage(objects: Record<string, string>): boolean {
	return ["reader", "outline", "meta", "asset-manifest"].every((name) => Boolean(objects[name]));
}

function isPublishedVersion(version: DocsAppProjection["documentVersions"][number]): boolean {
	return version.deliveryMode === "public_static_asset"
		? version.visibilityLevel === "public" && version.entitlementGroups.length === 0
		: version.visibilityLevel === "restricted" && version.entitlementGroups.length > 0;
}

function scope(value: { collection: string; corpus: string }): string {
	return `${value.corpus}/${value.collection}`;
}

function unique(values: string[], label: string): Set<string> {
	const set = new Set<string>();
	for (const value of values) {
		if (!value.trim()) throw new Error(`${label} must be non-empty`);
		if (set.has(value)) throw new Error(`duplicate ${label}: ${value}`);
		set.add(value);
	}
	return set;
}

function sortRecord(value: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, child]) => [key, sortJson(child)]),
		);
	}
	return value;
}
