import { writeFileSync } from "node:fs";
import process from "node:process";
import { Client, type ClientConfig } from "pg";

import type { Env } from "../src/config";
import { buildOperatorDatabaseConfig } from "../src/db/runtime";
import {
	buildDocsReadModelImportPlan,
	buildPublicDocsSyncManifestFromReadModel,
	type DocsReadModelManifestInput,
} from "../src/modules/docs/read-model-manifest";

export function resolvePublicDocsSyncManifestOutputPath(
	argv: string[],
	env: NodeJS.ProcessEnv,
): string | undefined {
	const positional = argv.filter((token) => token !== "--");
	if (positional.length > 1) {
		throw new Error(
			`expected at most one public docs sync manifest path, got ${positional.length}.`,
		);
	}
	return positional[0] || env.PUBLIC_DOCS_SYNC_MANIFEST_PATH?.trim() || undefined;
}

function buildEnv(source: NodeJS.ProcessEnv): Env {
	return {
		APP_API_DATABASE_SSLMODE: source.APP_API_DATABASE_SSLMODE as Env["APP_API_DATABASE_SSLMODE"],
		APP_API_ENVIRONMENT: source.APP_API_ENVIRONMENT as Env["APP_API_ENVIRONMENT"],
		APP_API_OPERATOR_DATABASE_URL: source.APP_API_OPERATOR_DATABASE_URL,
	};
}

async function loadReadModelManifest(client: Client): Promise<DocsReadModelManifestInput> {
	const collections = await client.query(
		"select corpus, collection, display_name, description, updated_at from docs.collections order by corpus, collection",
	);
	const documents = await client.query(
		"select doc_id, corpus, collection, document_slug, title, canonical_url, current_version_id, current_version_slug, updated_at from docs.documents order by corpus, collection, document_slug",
	);
	const versions = await client.query(
		"select version_id, doc_id, version_slug, label, effective_from, is_current, visibility_level, entitlement_groups_json, delivery_mode, updated_at from docs.document_versions order by doc_id, version_slug",
	);
	const assets = await client.query(
		"select version_id, static_prefix, content_url, outline_url, manifest_url, source_objects_json, target_objects_json, updated_at from docs.reader_assets order by version_id",
	);
	const searchUnits = await client.query(
		"select search_unit_id, doc_id, version_id, title, anchor, canonical_url, highlight_root_unit_ids_json, snippet, search_text, unit_order from docs.search_units order by version_id, unit_order",
	);

	return {
		collections: collections.rows.map((row) => ({
			collection: row.collection,
			corpus: row.corpus,
			description: row.description,
			displayName: row.display_name,
			updatedAt: row.updated_at.toISOString(),
		})),
		documentVersions: versions.rows.map((row) => ({
			deliveryMode: row.delivery_mode,
			docId: row.doc_id,
			effectiveFrom: row.effective_from,
			entitlementGroups: row.entitlement_groups_json ?? [],
			isCurrent: row.is_current,
			label: row.label,
			updatedAt: row.updated_at.toISOString(),
			versionId: row.version_id,
			versionSlug: row.version_slug,
			visibilityLevel: row.visibility_level,
		})),
		documents: documents.rows.map((row) => ({
			canonicalUrl: row.canonical_url,
			collection: row.collection,
			corpus: row.corpus,
			currentVersionId: row.current_version_id,
			currentVersionSlug: row.current_version_slug,
			docId: row.doc_id,
			documentSlug: row.document_slug,
			title: row.title,
			updatedAt: row.updated_at.toISOString(),
		})),
		generatedAt: new Date().toISOString(),
		readerAssets: assets.rows.map((row) => ({
			contentUrl: row.content_url,
			manifestUrl: row.manifest_url,
			outlineUrl: row.outline_url,
			sourceObjects: row.source_objects_json ?? {},
			staticPrefix: row.static_prefix,
			targetObjects: row.target_objects_json ?? {},
			updatedAt: row.updated_at.toISOString(),
			versionId: row.version_id,
		})),
		schemaVersion: "document_reader_publish_manifest_v1",
		searchUnits: searchUnits.rows.map((row) => ({
			anchor: row.anchor,
			canonicalUrl: row.canonical_url,
			docId: row.doc_id,
			highlightRootUnitIds: row.highlight_root_unit_ids_json ?? [],
			searchText: row.search_text,
			searchUnitId: row.search_unit_id,
			snippet: row.snippet,
			title: row.title,
			unitOrder: row.unit_order,
			versionId: row.version_id,
		})),
	};
}

async function main(): Promise<void> {
	const client = new Client(buildOperatorDatabaseConfig(buildEnv(process.env)) as ClientConfig);
	await client.connect();
	try {
		const plan = buildDocsReadModelImportPlan(await loadReadModelManifest(client));
		const manifest = buildPublicDocsSyncManifestFromReadModel(plan, new Date().toISOString());
		const payload = `${JSON.stringify(manifest, undefined, 2)}\n`;
		const outputPath = resolvePublicDocsSyncManifestOutputPath(process.argv.slice(2), process.env);
		if (outputPath) {
			writeFileSync(outputPath, payload, "utf8");
		} else {
			process.stdout.write(payload);
		}
	} finally {
		await client.end();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.stack || error.message : String(error));
		process.exit(1);
	});
}
