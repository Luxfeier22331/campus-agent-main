import { readFileSync } from "node:fs";

import {
	buildDocsReadModelImportPlan,
	type DocsReadModelImportPlan,
	type DocsReadModelManifestInput,
} from "../../src/modules/docs/read-model-manifest";

interface Queryable {
	query(sql: string, values?: unknown[]): Promise<unknown>;
}

export async function importDocsReadModelPlan(
	client: Queryable,
	plan: DocsReadModelImportPlan,
): Promise<void> {
	await client.query("begin");
	try {
		for (const scope of plan.scopes) {
			await client.query("delete from docs.documents where corpus = $1 and collection = $2", [
				scope.corpus,
				scope.collection,
			]);
			await client.query("delete from docs.collections where corpus = $1 and collection = $2", [
				scope.corpus,
				scope.collection,
			]);
		}

		for (const collection of plan.collections) {
			await client.query(
				`
insert into docs.collections (corpus, collection, display_name, description, updated_at)
values ($1, $2, $3, $4, $5)
on conflict (corpus, collection) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  updated_at = excluded.updated_at
`,
				[
					collection.corpus,
					collection.collection,
					collection.displayName,
					collection.description ?? null,
					collection.updatedAt,
				],
			);
		}

		for (const document of plan.documents) {
			await client.query(
				`
insert into docs.documents (
  doc_id, corpus, collection, document_slug, title, canonical_url,
  current_version_id, current_version_slug, updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
on conflict (doc_id) do update set
  corpus = excluded.corpus,
  collection = excluded.collection,
  document_slug = excluded.document_slug,
  title = excluded.title,
  canonical_url = excluded.canonical_url,
  current_version_id = excluded.current_version_id,
  current_version_slug = excluded.current_version_slug,
  updated_at = excluded.updated_at
`,
				[
					document.docId,
					document.corpus,
					document.collection,
					document.documentSlug,
					document.title,
					document.canonicalUrl,
					document.currentVersionId,
					document.currentVersionSlug,
					document.updatedAt,
				],
			);
		}

		for (const version of plan.documentVersions) {
			await client.query(
				`
insert into docs.document_versions (
  version_id, doc_id, version_slug, label, effective_from, is_current,
  visibility_level, entitlement_groups_json, delivery_mode, updated_at
)
values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
on conflict (version_id) do update set
  doc_id = excluded.doc_id,
  version_slug = excluded.version_slug,
  label = excluded.label,
  effective_from = excluded.effective_from,
  is_current = excluded.is_current,
  visibility_level = excluded.visibility_level,
  entitlement_groups_json = excluded.entitlement_groups_json,
  delivery_mode = excluded.delivery_mode,
  updated_at = excluded.updated_at
`,
				[
					version.versionId,
					version.docId,
					version.versionSlug,
					version.label,
					version.effectiveFrom ?? null,
					version.isCurrent,
					version.visibilityLevel,
					JSON.stringify(version.entitlementGroups),
					version.deliveryMode,
					version.updatedAt,
				],
			);
		}

		for (const asset of plan.readerAssets) {
			await client.query(
				`
insert into docs.reader_assets (
  version_id, static_prefix, content_url, outline_url, manifest_url,
  source_objects_json, target_objects_json, updated_at
)
values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
on conflict (version_id) do update set
  static_prefix = excluded.static_prefix,
  content_url = excluded.content_url,
  outline_url = excluded.outline_url,
  manifest_url = excluded.manifest_url,
  source_objects_json = excluded.source_objects_json,
  target_objects_json = excluded.target_objects_json,
  updated_at = excluded.updated_at
`,
				[
					asset.versionId,
					asset.staticPrefix,
					asset.contentUrl,
					asset.outlineUrl,
					asset.manifestUrl ?? null,
					JSON.stringify(asset.sourceObjects),
					JSON.stringify(asset.targetObjects),
					asset.updatedAt,
				],
			);
		}

		for (const unit of plan.searchUnits) {
			await client.query(
				`
insert into docs.search_units (
  search_unit_id, doc_id, version_id, title, anchor, canonical_url,
  highlight_root_unit_ids_json, snippet, search_text, unit_order
)
values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
on conflict (search_unit_id) do update set
  doc_id = excluded.doc_id,
  version_id = excluded.version_id,
  title = excluded.title,
  anchor = excluded.anchor,
  canonical_url = excluded.canonical_url,
  highlight_root_unit_ids_json = excluded.highlight_root_unit_ids_json,
  snippet = excluded.snippet,
  search_text = excluded.search_text,
  unit_order = excluded.unit_order
`,
				[
					unit.searchUnitId,
					unit.docId,
					unit.versionId,
					unit.title,
					unit.anchor,
					unit.canonicalUrl,
					JSON.stringify(unit.highlightRootUnitIds),
					unit.snippet,
					unit.searchText,
					unit.unitOrder,
				],
			);
		}

		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

export function readDocsReadModelManifest(path: string): DocsReadModelManifestInput {
	return JSON.parse(readFileSync(path, "utf8")) as DocsReadModelManifestInput;
}

export function resolveDocsReadModelManifestPath(argv: string[], env: NodeJS.ProcessEnv): string {
	const positional = argv.filter((token) => token !== "--");
	if (positional.length > 1) {
		throw new Error(
			`expected exactly one docs read-model manifest path, got ${positional.length}.`,
		);
	}
	const manifestPath = positional[0] || env.DOCS_READ_MODEL_MANIFEST_PATH?.trim();
	if (!manifestPath) {
		throw new Error("DOCS_READ_MODEL_MANIFEST_PATH or manifest path argument is required.");
	}
	return manifestPath;
}

export function buildDocsReadModelPlanFromManifestPath(path: string): DocsReadModelImportPlan {
	return buildDocsReadModelImportPlan(readDocsReadModelManifest(path));
}
