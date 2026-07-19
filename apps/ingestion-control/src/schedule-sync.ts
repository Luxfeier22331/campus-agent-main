import {
	Client,
	Connection,
	ScheduleAlreadyRunning,
	type ScheduleOptions,
	ScheduleOverlapPolicy,
} from "@temporalio/client";

import {
	INTERNAL_PORTAL_AUTH_INITIAL_PAUSE_NOTE,
	INTERNAL_PORTAL_AUTH_INTERVAL,
	INTERNAL_PORTAL_AUTH_SCHEDULE_ID,
	INTERNAL_PORTAL_AUTH_WORKFLOW_ID,
} from "./internal-portal-auth-maintenance";
import {
	INTERNAL_PORTAL_NOTICE_PUBLICATION_INITIAL_PAUSE_NOTE,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_INTERVAL,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID,
	INTERNAL_PORTAL_NOTICE_PUBLICATION_WORKFLOW_ID,
} from "./internal-portal-publication";
import { buildIngestionTemporalConfig, type IngestionTemporalConfig } from "./temporal-config";
import {
	internalPortalAuthMaintenanceWorkflow,
	internalPortalNoticePublicationWorkflow,
} from "./workflows/ingestion-task-workflow";

type MaintenanceScheduleOptions = ScheduleOptions<{
	args: [{ controlActivityTaskQueue: string; sourceCollectorActivityTaskQueue: string }];
	taskQueue: string;
	type: "startWorkflow";
	workflowId: string;
	workflowType: typeof internalPortalAuthMaintenanceWorkflow;
}>;

type NoticeScheduleOptions = ScheduleOptions<{
	args: [
		{
			collectionMode: "incremental";
			controlActivityTaskQueue: string;
			createdBy: string;
			overlapPages: number;
			rustKernelActivityTaskQueue: string;
			sourceCollectorActivityTaskQueue: string;
		},
	];
	taskQueue: string;
	type: "startWorkflow";
	workflowId: string;
	workflowType: typeof internalPortalNoticePublicationWorkflow;
}>;

export interface MaintenanceScheduleClient {
	create(options: MaintenanceScheduleOptions): Promise<unknown>;
	getHandle(scheduleId: string): {
		update(
			updateFn: (previous: { state: { note?: string; paused: boolean } }) => Omit<
				MaintenanceScheduleOptions,
				"memo" | "scheduleId"
			> & {
				state: { note?: string; paused: boolean };
			},
		): Promise<void>;
	};
}

export interface NoticeScheduleClient {
	create(options: NoticeScheduleOptions): Promise<unknown>;
	getHandle(scheduleId: string): {
		update(
			updateFn: (previous: { state: { note?: string; paused: boolean } }) => Omit<
				NoticeScheduleOptions,
				"memo" | "scheduleId"
			> & {
				state: { note?: string; paused: boolean };
			},
		): Promise<void>;
	};
}

export function buildInternalPortalNoticeScheduleOptions(
	config: IngestionTemporalConfig,
): NoticeScheduleOptions {
	return {
		action: {
			args: [
				{
					collectionMode: "incremental",
					controlActivityTaskQueue: config.controlActivityTaskQueue,
					createdBy: "schedule:internal-portal-notice",
					overlapPages: 1,
					rustKernelActivityTaskQueue: config.rustKernelActivityTaskQueue,
					sourceCollectorActivityTaskQueue: config.sourceCollectorActivityTaskQueue,
				},
			],
			taskQueue: config.workflowTaskQueue,
			type: "startWorkflow",
			workflowId: INTERNAL_PORTAL_NOTICE_PUBLICATION_WORKFLOW_ID,
			workflowType: internalPortalNoticePublicationWorkflow,
		},
		memo: { owner: "ingestion-control", purpose: "internal-portal-notice-publication" },
		policies: {
			catchupWindow: INTERNAL_PORTAL_NOTICE_PUBLICATION_INTERVAL,
			overlap: ScheduleOverlapPolicy.SKIP,
			pauseOnFailure: true,
		},
		scheduleId: INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID,
		spec: { intervals: [{ every: INTERNAL_PORTAL_NOTICE_PUBLICATION_INTERVAL }] },
		state: {
			note: INTERNAL_PORTAL_NOTICE_PUBLICATION_INITIAL_PAUSE_NOTE,
			paused: true,
		},
	};
}

export function buildInternalPortalAuthScheduleOptions(
	config: IngestionTemporalConfig,
): MaintenanceScheduleOptions {
	return {
		action: {
			args: [
				{
					controlActivityTaskQueue: config.controlActivityTaskQueue,
					sourceCollectorActivityTaskQueue: config.sourceCollectorActivityTaskQueue,
				},
			],
			taskQueue: config.workflowTaskQueue,
			type: "startWorkflow",
			workflowId: INTERNAL_PORTAL_AUTH_WORKFLOW_ID,
			workflowType: internalPortalAuthMaintenanceWorkflow,
		},
		memo: { owner: "ingestion-control", purpose: "internal-portal-auth-maintenance" },
		policies: {
			catchupWindow: INTERNAL_PORTAL_AUTH_INTERVAL,
			overlap: ScheduleOverlapPolicy.SKIP,
			pauseOnFailure: true,
		},
		scheduleId: INTERNAL_PORTAL_AUTH_SCHEDULE_ID,
		spec: { intervals: [{ every: INTERNAL_PORTAL_AUTH_INTERVAL }] },
		state: { note: INTERNAL_PORTAL_AUTH_INITIAL_PAUSE_NOTE, paused: true },
	};
}

export async function syncInternalPortalAuthSchedule(
	client: MaintenanceScheduleClient,
	config: IngestionTemporalConfig,
): Promise<"created" | "updated"> {
	const desired = buildInternalPortalAuthScheduleOptions(config);
	try {
		await client.create(desired);
		return "created";
	} catch (error) {
		if (!(error instanceof ScheduleAlreadyRunning)) {
			throw error;
		}
	}

	await client.getHandle(INTERNAL_PORTAL_AUTH_SCHEDULE_ID).update((previous) => ({
		action: desired.action,
		policies: desired.policies,
		spec: desired.spec,
		state: {
			note: previous.state.note,
			paused: previous.state.paused,
		},
	}));
	return "updated";
}

export async function syncInternalPortalNoticeSchedule(
	client: NoticeScheduleClient,
	config: IngestionTemporalConfig,
): Promise<"created" | "updated"> {
	const desired = buildInternalPortalNoticeScheduleOptions(config);
	try {
		await client.create(desired);
		return "created";
	} catch (error) {
		if (!(error instanceof ScheduleAlreadyRunning)) {
			throw error;
		}
	}
	await client.getHandle(INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID).update((previous) => ({
		action: desired.action,
		policies: desired.policies,
		spec: desired.spec,
		state: { note: previous.state.note, paused: previous.state.paused },
	}));
	return "updated";
}

export async function main(): Promise<void> {
	const config = buildIngestionTemporalConfig(process.env);
	const connection = await Connection.connect({ address: config.address });
	try {
		const client = new Client({ connection, namespace: config.namespace });
		const auth = await syncInternalPortalAuthSchedule(client.schedule, config);
		const notice = await syncInternalPortalNoticeSchedule(client.schedule, config);
		console.info(
			JSON.stringify({
				schedules: [
					{ scheduleId: INTERNAL_PORTAL_AUTH_SCHEDULE_ID, status: auth },
					{ scheduleId: INTERNAL_PORTAL_NOTICE_PUBLICATION_SCHEDULE_ID, status: notice },
				],
			}),
		);
	} finally {
		await connection.close();
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
