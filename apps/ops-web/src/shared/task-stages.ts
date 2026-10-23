import { z } from "zod";

export const TaskStageSchema = z
	.object({
		id: z.string(),
		outcome: z.enum([
			"success",
			"partial",
			"failed",
			"skipped",
			"unknown",
			"running",
			"completed",
			"timed_out",
			"canceled",
			"terminated",
		]),
		counts: z.record(z.string(), z.number()),
		error: z.string().nullable(),
		phase: z.enum(["scanning", "processing", "writing", "finalizing"]).optional(),
		processedRange: z.object({ from: z.string(), to: z.string() }).optional(),
		maintenanceRange: z.object({ from: z.string(), to: z.string() }).optional(),
		activity: z
			.object({
				state: z.enum([
					"waiting",
					"running",
					"cancel_requested",
					"paused",
					"pause_requested",
					"unknown",
				]),
				attempt: z.number().nullable(),
				maximumAttempts: z.number().nullable(),
				nextAttemptAt: z.string().nullable(),
				scheduledAt: z.string().nullable().optional(),
				startedAt: z.string().nullable(),
				lastHeartbeatAt: z.string().nullable(),
				lastFailure: z.string().nullable(),
			})
			.optional(),
	})
	.strict();
export type TaskStage = z.infer<typeof TaskStageSchema>;
export const taskStageLabels: Record<string, string> = {
	collection: "采集",
	classification: "分类",
	publication: "发布",
	rag: "索引刷新",
	cleanup: "清理",
	files: "文件同步",
	collectNotices: "采集",
	syncFiles: "文件同步",
	classifyNotices: "分类",
	publishNoticesStage: "发布",
};
export const taskOutcomeLabels = {
	completed: "已完成",
	timed_out: "已超时",
	canceled: "已取消",
	terminated: "已终止",
	success: "成功",
	partial: "部分失败",
	failed: "失败",
	skipped: "跳过",
	unknown: "未知",
	running: "运行中",
};
export const taskStatusLabels: Record<string, string> = {
	running: "运行中",
	pending: "等待中",
	succeeded: "已完成",
	completed: "已完成",
	failed: "失败",
	canceled: "已取消",
	cancelled: "已取消",
	terminated: "已终止",
	timed_out: "已超时",
};

export const taskPhaseLabels = {
	scanning: "扫描通知列表",
	processing: "处理通知",
	writing: "写入结果",
	finalizing: "汇总结果",
};
export const taskActivityStateLabels = {
	waiting: "等待执行",
	running: "执行中",
	cancel_requested: "等待取消",
	paused: "已暂停",
	pause_requested: "等待暂停",
	unknown: "执行状态未提供",
};
