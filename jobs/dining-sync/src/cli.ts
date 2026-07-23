import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { S3DiningAttachmentStore } from "./attachment-store.ts";
import { buildCatalogObservations } from "./catalog-source.ts";
import {
	DINING_MEDIA_BUCKET,
	DINING_MEDIA_REGION,
	loadCatalogSyncConfig,
	loadDatabaseInstallConfig,
	loadReviewRecheckConfig,
	loadReviewSyncConfig,
} from "./config.ts";
import { LarkDiningClient } from "./lark-client.ts";
import { installDiningDatabase } from "./migrate.ts";
import { GiteeAiDiningModerator } from "./moderation.ts";
import { PostgresDiningReviewPublisher } from "./postgres-publisher.ts";
import { PostgresDiningPublishedSnapshotReader } from "./published-snapshot-reader.ts";
import { processDiningReviewRechecks } from "./review-recheck.ts";
import { PublishedDiningReviewResolver } from "./review-resolver.ts";
import {
	DiningEmptySnapshotError,
	type DiningSyncRun,
	PostgresDiningSourceObservationStore,
} from "./source-observation-store.ts";
import { runDiningSync } from "./sync-pipeline.ts";

const USAGE = "Usage: dining-sync [catalog-sync|review-sync|review-recheck|db-install]";

async function main(): Promise<void> {
	const command = process.argv[2];
	if (command === "catalog-sync") {
		await runCatalogSync();
		return;
	}
	if (command === "review-sync") {
		await runReviewSync();
		return;
	}
	if (command === "review-recheck") {
		await runReviewRecheck();
		return;
	}
	if (command === "db-install") {
		console.log(
			JSON.stringify(await installDiningDatabase(loadDatabaseInstallConfig().postgresUrl)),
		);
		return;
	}
	throw new Error(USAGE);
}

async function runCatalogSync(): Promise<void> {
	const config = loadCatalogSyncConfig();
	const store = new PostgresDiningSourceObservationStore({ databaseUrl: config.postgresUrl });
	const run = await store.startRun("feishu_catalog");
	try {
		const lark = new LarkDiningClient({ ...config.lark });
		const records = await lark.listCatalogRecords();
		const observations = buildCatalogObservations(records, new Date());
		const report = await store.completeCatalogRun({
			observations,
			run,
			sourceIdentity: {
				baseToken: config.lark.baseToken,
				campusTableId: config.lark.catalog.campusTableId,
				dishTableId: config.lark.catalog.dishTableId,
				hallTableId: config.lark.catalog.hallTableId,
				stallTableId: config.lark.catalog.stallTableId,
			},
		});
		await store.succeedRun(run);
		console.log(JSON.stringify({ ...report, status: "catalog_synced" }));
	} catch (error) {
		await recordRunFailure(store, run, error);
		throw error;
	}
}

async function runReviewSync(): Promise<void> {
	const config = loadReviewSyncConfig();
	const store = new PostgresDiningSourceObservationStore({ databaseUrl: config.postgresUrl });
	const run = await store.startRun("feishu_review");
	try {
		const published = await new PostgresDiningPublishedSnapshotReader(config.postgresUrl).read();
		const lark = new LarkDiningClient({ ...config.lark });
		const source = await lark.listReviewRecords();
		const moderator = new GiteeAiDiningModerator({ apiKey: config.moderationApiKey });
		const credentials = {
			accessKeyId: config.objectStore.accessKey,
			secretAccessKey: config.objectStore.secretKey,
		};
		const internalS3 = new S3Client({
			credentials,
			endpoint: config.objectStore.endpoint,
			forcePathStyle: true,
			region: DINING_MEDIA_REGION,
		});
		const publicS3 = new S3Client({
			credentials,
			endpoint: config.objectStore.publicEndpoint,
			forcePathStyle: true,
			region: DINING_MEDIA_REGION,
		});
		const report = await runDiningSync({
			attachmentStore: new S3DiningAttachmentStore({
				bucket: DINING_MEDIA_BUCKET,
				downloader: lark,
				imageModerator: moderator,
				publicEndpoint: config.objectStore.publicEndpoint,
				s3: internalS3,
				signedUrlFor: ({ bucket, key }) =>
					getSignedUrl(publicS3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
						expiresIn: 300,
					}),
			}),
			catalogReleaseId: published.releaseId,
			moderator,
			observationStore: store,
			publisher: new PostgresDiningReviewPublisher(config.postgresUrl),
			records: source.records,
			reviewResolver: new PublishedDiningReviewResolver(published.snapshot),
			run,
			sourceIdentity: {
				baseToken: config.lark.baseToken,
				reviewTableId: config.lark.review.tableId,
			},
		});
		console.log(JSON.stringify(report));
	} catch (error) {
		await recordRunFailure(store, run, error);
		throw error;
	}
}

async function runReviewRecheck(): Promise<void> {
	const config = loadReviewRecheckConfig();
	const report = await processDiningReviewRechecks({
		databaseUrl: config.postgresUrl,
		moderator: new GiteeAiDiningModerator({ apiKey: config.moderationApiKey }),
	});
	console.log(JSON.stringify(report));
}

async function recordRunFailure(
	store: PostgresDiningSourceObservationStore,
	run: DiningSyncRun,
	error: unknown,
): Promise<void> {
	const code = error instanceof DiningEmptySnapshotError ? "empty_snapshot" : "sync_failed";
	try {
		await store.failRun(run, code, error);
	} catch (recordError) {
		throw new AggregateError(
			[error, recordError],
			"Dining sync failed and its run could not be updated.",
		);
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
