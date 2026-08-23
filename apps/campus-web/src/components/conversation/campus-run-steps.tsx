import { Button, cn } from "@campus-agent/ui";
import { CheckIcon, CircleIcon, LoaderCircleIcon, RefreshCwIcon, XIcon } from "lucide-react";
import type {
	ChatRunProductPhase,
	ChatRunStep,
	ChatRunStepPhase,
} from "@/features/conversation/run-client";

export const CAMPUS_RUN_STEP_PHASES: readonly ChatRunProductPhase[] = [
	"preparing",
	"generating",
	"finalizing",
];

const STEP_LABELS: Record<ChatRunProductPhase, string> = {
	finalizing: "整理回答",
	generating: "生成回答",
	preparing: "准备回答",
};

const TERMINAL_STEP_STATUSES = new Set<ChatRunStep["status"]>(["completed", "failed", "cancelled"]);
const STEP_STATUS_PRIORITY: Record<ChatRunStep["status"], number> = {
	cancelled: 3,
	completed: 1,
	failed: 4,
	pending: 0,
	running: 2,
};

type CampusRunStepState = ChatRunStep["status"];
type CampusDisplayRunStep = Omit<ChatRunStep, "phase"> & { phase: ChatRunProductPhase };

function displayPhase(phase: ChatRunStepPhase): ChatRunProductPhase {
	return phase === "queued" ? "preparing" : phase;
}

function timestampValue(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function earliestTimestamp(steps: readonly ChatRunStep[]): string | null {
	return steps.reduce<string | null>((current, step) => {
		const candidate = timestampValue(step.startedAt);
		if (candidate === null) {
			return current;
		}
		const currentValue = timestampValue(current);
		if (currentValue === null || candidate < currentValue) {
			return step.startedAt;
		}
		return current;
	}, null);
}

function latestTimestamp(steps: readonly ChatRunStep[]): string | null {
	return steps.reduce<string | null>((current, step) => {
		const candidate = timestampValue(step.completedAt);
		if (candidate === null) {
			return current;
		}
		const currentValue = timestampValue(current);
		if (currentValue === null || candidate > currentValue) {
			return step.completedAt;
		}
		return current;
	}, null);
}

function mergedStepDuration(
	steps: readonly ChatRunStep[],
	startedAt: string | null,
	completedAt: string | null,
	status: CampusRunStepState,
): number | null {
	if (!TERMINAL_STEP_STATUSES.has(status)) {
		return null;
	}
	const started = timestampValue(startedAt);
	const completed = timestampValue(completedAt);
	if (started !== null && completed !== null && completed >= started) {
		return completed - started;
	}
	const durations = steps.map((step) => step.durationMs);
	const knownDurations = durations.filter(
		(duration): duration is number => duration !== null && Number.isFinite(duration),
	);
	return knownDurations.length === durations.length
		? knownDurations.reduce((total, duration) => total + duration, 0)
		: (knownDurations[0] ?? null);
}

function mergedStepStatus(steps: readonly ChatRunStep[]): CampusRunStepState {
	return steps.reduce<CampusRunStepState>(
		(current, step) =>
			STEP_STATUS_PRIORITY[step.status] > STEP_STATUS_PRIORITY[current] ? step.status : current,
		"pending",
	);
}

/**
 * `queued` remains available in the run protocol, but it is an internal
 * scheduling fact. The chat surface presents it as part of `preparing`.
 */
export function projectCampusRunSteps(
	steps: readonly ChatRunStep[],
): readonly CampusDisplayRunStep[] {
	const grouped = new Map<ChatRunProductPhase, ChatRunStep[]>();
	for (const step of steps) {
		const phase = displayPhase(step.phase);
		const group = grouped.get(phase) ?? [];
		group.push(step);
		grouped.set(phase, group);
	}

	return [...grouped.entries()]
		.map(([phase, group]) => {
			const status = mergedStepStatus(group);
			const startedAt = earliestTimestamp(group);
			const completedAt = TERMINAL_STEP_STATUSES.has(status) ? latestTimestamp(group) : null;
			return {
				completedAt,
				durationMs: mergedStepDuration(group, startedAt, completedAt, status),
				phase,
				startedAt,
				status,
			};
		})
		.sort(
			(a, b) => CAMPUS_RUN_STEP_PHASES.indexOf(a.phase) - CAMPUS_RUN_STEP_PHASES.indexOf(b.phase),
		);
}

function stepStateLabel(status: CampusRunStepState): string {
	switch (status) {
		case "completed":
			return "已完成";
		case "running":
			return "进行中";
		case "failed":
			return "失败";
		case "cancelled":
			return "已取消";
		default:
			return "等待中";
	}
}

export function formatRunDuration(durationMs: number | null): string {
	if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
		return "未记录";
	}
	if (durationMs < 1_000) {
		return "0秒";
	}
	const totalSeconds = Math.floor(durationMs / 1_000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) {
		return `${seconds}秒`;
	}
	return seconds === 0 ? `${minutes}分` : `${minutes}分${seconds}秒`;
}

function stepDurationLabel(step: ChatRunStep): string {
	if (step.durationMs !== null) {
		return formatRunDuration(step.durationMs);
	}
	return step.status === "running" ? "进行中" : stepStateLabel(step.status);
}

function StepIcon({ status }: { status: CampusRunStepState }) {
	if (status === "completed") {
		return <CheckIcon aria-hidden className="text-muted-foreground size-4" />;
	}
	if (status === "failed") {
		return <XIcon aria-hidden className="text-destructive size-4" />;
	}
	if (status === "cancelled") {
		return <XIcon aria-hidden className="text-muted-foreground size-4" />;
	}
	if (status === "running") {
		return (
			<LoaderCircleIcon
				aria-hidden
				className="text-muted-foreground motion-safe:animate-spin motion-reduce:animate-none size-4"
			/>
		);
	}
	return <CircleIcon aria-hidden className="text-muted-foreground size-4" />;
}

export interface CampusRunStepsProps {
	error?: string | null;
	onRetry?: (() => void) | undefined;
	steps: readonly ChatRunStep[];
}

export function CampusRunSteps({ error, onRetry, steps }: CampusRunStepsProps) {
	if (error) {
		return (
			<div className="text-danger flex flex-wrap items-center gap-2 py-1 text-xs">
				<span>{error}</span>
				{onRetry ? (
					<Button
						aria-label="重试加载回答过程"
						className="h-7 px-2 text-xs"
						onClick={onRetry}
						variant="ghost"
					>
						<RefreshCwIcon aria-hidden className="size-3.5" />
						重试
					</Button>
				) : null}
			</div>
		);
	}

	const visibleSteps = projectCampusRunSteps(steps);
	if (visibleSteps.length === 0) {
		return null;
	}

	return (
		<ol aria-label="回答过程" className="flex flex-col">
			{visibleSteps.map((step, index) => {
				const isLast = index === visibleSteps.length - 1;
				return (
					<li
						className={cn(
							"relative grid min-h-7 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 text-[13px]",
						)}
						key={step.phase}
					>
						{isLast ? null : (
							<span
								aria-hidden
								className="bg-border/70 absolute start-[0.6rem] top-6 bottom-[-0.25rem] w-px"
							/>
						)}
						<span className="flex size-5 items-center justify-center">
							<StepIcon status={step.status} />
						</span>
						<span
							className={cn(
								"min-w-0 truncate",
								step.status === "running" ? "text-foreground" : "text-muted-foreground",
							)}
						>
							{STEP_LABELS[step.phase]}
						</span>
						<span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
							{stepDurationLabel(step)}
						</span>
					</li>
				);
			})}
		</ol>
	);
}

export { STEP_LABELS as campusRunStepLabels, stepStateLabel as campusRunStepStateLabel };
