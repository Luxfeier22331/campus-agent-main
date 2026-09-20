import { z } from "zod";
export const TaskIdSchema = z.enum([
	"notice-sync",
	"notice-classifier",
	"notice-publisher",
	"campus-rag-refresh",
	"document-ocr",
	"internal-portal-credential-checker",
]);
export type TaskId = z.infer<typeof TaskIdSchema>;
export const TaskScheduleInputSchema = z
	.object({
		enabled: z.boolean(),
		intervalMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
	})
	.strict();
export type TaskScheduleInput = z.infer<typeof TaskScheduleInputSchema>;
export interface TaskRun {
	id: string;
	workflowId: string | null;
	runId: string | null;
	status: string;
	outcome: "success" | "partial" | "failed" | "skipped" | "unknown";
	startedAt: string | null;
	completedAt: string | null;
	error: string | null;
	details: unknown;
}
export interface OpsTask {
	id: TaskId;
	label: string;
	runtime: "kubernetes" | "temporal";
	canSchedule: boolean;
	canRun: boolean;
	enabled: boolean | null;
	intervalMinutes: number | null;
	schedule: string | null;
	running: boolean;
	problemCount: number | null;
	runs: TaskRun[];
	error: string | null;
}
