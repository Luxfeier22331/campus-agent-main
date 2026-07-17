import { readFileSync } from "node:fs";
import { Client, type ClientConfig } from "pg";

import { parseProjection } from "./schema.ts";
import { normalizeProjection } from "./release.ts";
import type { DocsAppProjection, DocsObjectStore, DocsReleaseManifest } from "./types.ts";

export interface DocsMaterializeClient {
	query(sql: string, values?: unknown[]): Promise<unknown>;
}

export async function materializeDocsRelease(input: {
	manifest: DocsReleaseManifest;
	releaseId: string;
	store: DocsObjectStore;
	client?: Client;
}): Promise<void> {
	const projection = normalizeProjection(
		parseProjection(
			JSON.parse(new TextDecoder().decode(await input.store.read(input.manifest.projection))),
		),
	);
	const client = input.client ?? new Client(databaseConfig(process.env));
	const ownsClient = !input.client;
	if (ownsClient) await client.connect();
	try {
		await materializeProjection(client, input.releaseId, input.manifest, projection);
	} finally {
		if (ownsClient) await client.end();
	}
}

export async function materializeProjection(
	client: DocsMaterializeClient,
	releaseId: string,
	manifest: DocsReleaseManifest,
	projection: DocsAppProjection,
): Promise<void> {
	await client.query("begin");
	try {
		await client.query("delete from docs.releases where release_id = $1", [releaseId]);
		await client.query(
			`insert into docs.releases (release_id, manifest_key, manifest_sha256, materialized_at)
			 values ($1, $2, $3, now())`,
			[releaseId, `docs-reader/releases/sha256/${releaseId.slice(7)}/manifest.json`, releaseId],
		);
		for (const item of projection.collections) {
			await client.query(
				`insert into docs.collections
				 (release_id, corpus, collection, display_name, description, updated_at)
				 values ($1, $2, $3, $4, $5, $6)`,
				[releaseId, item.corpus, item.collection, item.displayName, item.description ?? null, item.updatedAt],
			);
		}
		for (const item of projection.documents) {
			await client.query(
				`insert into docs.documents
				 (release_id, doc_id, corpus, collection, document_slug, title, canonical_url,
				  current_version_id, current_version_slug, updated_at)
				 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
				[releaseId, item.docId, item.corpus, item.collection, item.documentSlug, item.title,
					item.canonicalUrl, item.currentVersionId, item.currentVersionSlug, item.updatedAt],
			);
		}
		for (const item of projection.documentVersions) {
			await client.query(
				`insert into docs.document_versions
				 (release_id, version_id, doc_id, version_slug, label, effective_from, is_current,
				  visibility_level, entitlement_groups_json, delivery_mode, updated_at)
				 values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
				[releaseId, item.versionId, item.docId, item.versionSlug, item.label,
					item.effectiveFrom ?? null, item.isCurrent, item.visibilityLevel,
					JSON.stringify(item.entitlementGroups), item.deliveryMode, item.updatedAt],
			);
		}
		for (const item of projection.readerAssets) {
			await client.query(
				`insert into docs.reader_assets
				 (release_id, version_id, static_prefix, content_url, outline_url, manifest_url,
				  source_objects_json, target_objects_json, updated_at)
				 values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
				[releaseId, item.versionId, item.staticPrefix, item.contentUrl, item.outlineUrl,
					item.manifestUrl ?? null, JSON.stringify(item.sourceObjects),
					JSON.stringify(item.targetObjects), item.updatedAt],
			);
		}
		for (const item of projection.searchUnits) {
			await client.query(
				`insert into docs.search_units
				 (release_id, search_unit_id, doc_id, version_id, title, anchor, canonical_url,
				  highlight_root_unit_ids_json, snippet, search_text, unit_order)
				 values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
				[releaseId, item.searchUnitId, item.docId, item.versionId, item.title, item.anchor,
					item.canonicalUrl, JSON.stringify(item.highlightRootUnitIds), item.snippet,
					item.searchText, item.unitOrder],
			);
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

function databaseConfig(env: NodeJS.ProcessEnv): ClientConfig {
	const connectionString = env.DOCS_PUBLISH_DATABASE_URL?.trim();
	if (!connectionString) throw new Error("DOCS_PUBLISH_DATABASE_URL is required for materialize");
	const sslMode = env.DOCS_PUBLISH_DATABASE_SSLMODE?.trim() || "verify-full";
	if (sslMode === "disable") return { connectionString, ssl: false };
	if (sslMode !== "verify-full") throw new Error("DOCS_PUBLISH_DATABASE_SSLMODE must be verify-full or disable");
	const caPath = env.DOCS_PUBLISH_DATABASE_CA_CERT_PATH?.trim();
	if (!caPath) throw new Error("DOCS_PUBLISH_DATABASE_CA_CERT_PATH is required for verify-full");
	return { connectionString, ssl: { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true } };
}
