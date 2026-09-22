import { BatchV1Api, KubeConfig, type V1CronJob } from "@kubernetes/client-node";
import { Client, Connection } from "@temporalio/client";
import { validateInternalPortalNoticeSyncState } from "ingestion-contracts";
import type {
	NoticeAutomation,
	NoticeAutomationInput,
} from "../shared/notice-automation-contract.ts";
import type { InternalPortalCredentialService } from "./internal-portal-credential-service.ts";
import type { NoticePreviewStore } from "./notice-preview.ts";

type BatchClient = Pick<
	InstanceType<typeof BatchV1Api>,
	"readNamespacedCronJob" | "patchNamespacedCronJob"
>;
export interface NoticeAutomationService {
	get(): Promise<NoticeAutomation>;
	update(input: NoticeAutomationInput): Promise<NoticeAutomation>;
}
export class NoticeAutomationError extends Error {
	readonly status: 409 | 503;
	constructor(message: string, status: 409 | 503 = 503) {
		super(message);
		this.status = status;
	}
}
const schedules = { 15: "*/15 * * * *", 30: "*/30 * * * *", 60: "0 * * * *" } as const;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createNoticeAutomationService(input: {
	local: boolean;
	namespace: string;
	env?: { TEMPORAL_ADDRESS?: string; TEMPORAL_NAMESPACE?: string };
	source: NoticePreviewStore;
	credentials: Pick<InternalPortalCredentialService, "list">;
	batch?: BatchClient;
}): NoticeAutomationService {
	const client = () => {
		if (input.batch) {
			return input.batch;
		}
		const config = new KubeConfig();
		config.loadFromCluster();
		return config.makeApiClient(BatchV1Api);
	};
	const temporal = async <T>(run: (client: Client) => Promise<T>) => {
		const connection = await Connection.connect({
			address: input.env?.TEMPORAL_ADDRESS ?? "temporal:7233",
		});
		try {
			return await run(
				new Client({ connection, namespace: input.env?.TEMPORAL_NAMESPACE ?? "default" }),
			);
		} finally {
			await connection.close();
		}
	};
	const readSchedule = async () => {
		if (input.batch) {
			return project(
				await client().readNamespacedCronJob({
					namespace: input.namespace,
					name: "notice-sync",
				}),
			);
		}
		return temporal(async (temporalClient) => {
			const description = await temporalClient.schedule.getHandle("notice-pipeline").describe();
			const every = description.spec.intervals?.[0]?.every;
			return {
				enabled: !description.state.paused,
				intervalMinutes: every ? every / 60_000 : null,
				timeZone: description.spec.timezone ?? null,
				lastScheduleTime: description.info?.recentActions?.[0]?.scheduledAt?.toISOString() ?? null,
				lastSuccessfulTime: null,
			};
		});
	};
	const project = (cron: V1CronJob) => ({
		enabled: !cron.spec?.suspend,
		intervalMinutes:
			([15, 30, 60] as const).find((value) => schedules[value] === cron.spec?.schedule) ?? null,
		timeZone: cron.spec?.timeZone ?? null,
		lastScheduleTime: cron.status?.lastScheduleTime?.toISOString() ?? null,
		lastSuccessfulTime: cron.status?.lastSuccessfulTime?.toISOString() ?? null,
	});
	const get = async (): Promise<NoticeAutomation> => {
		const result: NoticeAutomation = {
			supported: !input.local,
			enabled: null,
			intervalMinutes: null,
			timeZone: null,
			lastScheduleTime: null,
			lastSuccessfulTime: null,
			maintenanceRange: null,
			credentialAvailable: null,
			scheduleError: null,
			stateError: null,
			credentialError: null,
		};
		await Promise.all([
			(async () => {
				if (input.local) {
					return;
				}
				try {
					Object.assign(result, await readSchedule());
				} catch (error) {
					result.scheduleError = errorMessage(error);
				}
			})(),
			(async () => {
				try {
					const object = await input.source.get("internal_portal/notices/_state.json");
					const value = await new Response(object.body).json();
					if (!validateInternalPortalNoticeSyncState(value).ok) {
						throw new Error("采集范围尚未初始化，请先完成历史回填。");
					}
					const state = value as { covered_from: string | null; covered_until: string | null };
					if (state.covered_from && state.covered_until) {
						result.maintenanceRange = { from: state.covered_from, to: state.covered_until };
					}
				} catch (error) {
					result.stateError = errorMessage(error);
				}
			})(),
			(async () => {
				try {
					result.credentialAvailable = (await input.credentials.list()).some(
						(credential) => credential.lastOutcome === "valid",
					);
				} catch (error) {
					result.credentialError = errorMessage(error);
				}
			})(),
		]);
		return result;
	};
	return {
		get,
		async update(value) {
			if (input.local) {
				throw new NoticeAutomationError("本地环境不运行定时采集。", 409);
			}
			if (value.enabled) {
				const current = await get();
				if (!current.maintenanceRange) {
					throw new NoticeAutomationError(current.stateError ?? "请先完成通知历史回填。", 409);
				}
				if (!current.credentialAvailable) {
					throw new NoticeAutomationError(
						current.credentialError ?? "请先配置可用的门户凭据。",
						409,
					);
				}
			}
			try {
				if (input.batch) {
					const cron = await client().patchNamespacedCronJob({
						namespace: input.namespace,
						name: "notice-sync",
						body: [
							{ op: "add", path: "/spec/suspend", value: !value.enabled },
							{ op: "add", path: "/spec/schedule", value: schedules[value.intervalMinutes] },
						],
					});
					return { ...(await get()), ...project(cron), scheduleError: null };
				}
				await temporal(async (temporalClient) => {
					await temporalClient.schedule.getHandle("notice-pipeline").update((existing) => ({
						...existing,
						spec: { ...existing.spec, intervals: [{ every: value.intervalMinutes * 60_000 }] },
						state: { ...existing.state, paused: !value.enabled },
					}));
				});
				return { ...(await get()), scheduleError: null };
			} catch (error) {
				throw new NoticeAutomationError(errorMessage(error));
			}
		},
	};
}
