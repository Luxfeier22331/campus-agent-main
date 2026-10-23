import { createNoticeDatabasePool, withNoticeProcessingLock } from "@campus-agent/notice-database";
import { Context, heartbeat } from "@temporalio/activity";
import {
	type CollectionCommand,
	executeCollectionCommand,
} from "internal-portal-collection/collection-command";
import { loadInternalPortalEnv } from "internal-portal-collection/config";
import { resolveInternalPortalCredentialFromEnv } from "internal-portal-collection/ops-web-credential-resolver";
import { runNoticeClassificationJob } from "notice-classifier/job";
import {
	createNoticeClassifierFromRuntimeConfig,
	resolveNoticeClassifierRuntimeConfig,
} from "notice-classifier/model";
import { internalPortalHost } from "notice-publisher/portal";
import { publishNotices, republishNotices } from "notice-publisher/publisher";
import { createPublisherObjectStoreFromEnv } from "notice-publisher/store";

export async function collectNotices(command: CollectionCommand = { mode: "notice-sync" }) {
	return activity(async (signal, report) => {
		loadInternalPortalEnv(process.env);
		const credential = await resolveInternalPortalCredentialFromEnv(process.env, {
			abortSignal: signal,
		});
		return await executeCollectionCommand(command, {
			abortSignal: signal,
			env: process.env,
			ssoTgc: credential.ssoTgc,
			onProgress: report,
		});
	});
}

export async function syncFiles() {
	return collectNotices({ mode: "file-sync" });
}

export async function classifyNotices(noticeIds?: readonly number[]) {
	return activity(async (signal, report) => {
		const pool = createNoticeDatabasePool(process.env, { max: 3 });
		try {
			const lockClient = await pool.connect();
			try {
				return await withNoticeProcessingLock(lockClient, "classification", async (lockSignal) => {
					const runtime = await resolveNoticeClassifierRuntimeConfig(
						fetch,
						process.env.MODEL_CONFIG_URL,
					);
					return await runNoticeClassificationJob({
						database: pool,
						signal: AbortSignal.any([signal, lockSignal]),
						createModelClassifier: () => createNoticeClassifierFromRuntimeConfig(runtime, fetch),
						onProgress: report,
						...(noticeIds ? { noticeIds } : {}),
					});
				});
			} finally {
				lockClient.release();
			}
		} finally {
			await pool.end();
		}
	});
}

export async function publishNoticesStage(noticeIds?: readonly number[], republish = false) {
	return activity(async (signal, report) => {
		const pool = createNoticeDatabasePool(process.env, { max: 2 });
		const client = await pool.connect();
		const store = createPublisherObjectStoreFromEnv(process.env);
		try {
			return await withNoticeProcessingLock(client, "publication", (lockSignal) =>
				(republish ? republishNotices : publishNotices)({
					client,
					signal: AbortSignal.any([signal, lockSignal]),
					objectStore: store,
					portalHost: internalPortalHost(),
					onProgress: report,
					...(noticeIds ? { noticeIds } : {}),
				}),
			);
		} finally {
			client.release();
			store.close();
			await pool.end();
		}
	});
}

async function activity<T>(
	run: (signal: AbortSignal, report: (progress: unknown) => void) => Promise<T>,
): Promise<T> {
	const signal = Context.current().cancellationSignal;
	let progress: unknown = { stage: Context.current().info.activityType };
	const timer = setInterval(() => heartbeat(progress), 10_000);
	try {
		signal.throwIfAborted();
		return await run(signal, (value) => {
			progress = value;
			heartbeat(value);
		});
	} catch (error) {
		// Aborted I/O surfaces as transport errors; report the cancellation so Temporal records it.
		signal.throwIfAborted();
		throw error;
	} finally {
		clearInterval(timer);
	}
}
