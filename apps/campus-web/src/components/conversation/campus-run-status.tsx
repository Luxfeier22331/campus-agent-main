import { useAui } from "@assistant-ui/react";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@campus-agent/ui";
import {
	ChevronRightIcon,
	CircleAlertIcon,
	ListTreeIcon,
	LoaderCircleIcon,
	RefreshCwIcon,
	WifiOffIcon,
	XIcon,
} from "lucide-react";
import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { type ChatRunStep, getRunSteps } from "@/features/conversation/run-client";
import type {
	CampusRunPhase,
	CampusRunStatus as CampusRunStatusValue,
	CampusRunViewState,
} from "@/features/conversation/run-view-state";
import { CAMPUS_RUN_STEP_PHASES, CampusRunSteps, formatRunDuration } from "./campus-run-steps";

const TERMINAL_STATUSES: readonly CampusRunStatusValue[] = ["completed", "failed", "cancelled"];

export interface CampusRunStatusRuntime {
	loadSteps(input: {
		runId: string;
		signal: AbortSignal;
	}): Promise<{ steps: readonly ChatRunStep[] }>;
	resume(): Promise<void>;
	now?: () => number;
}

const CampusRunStatusRuntimeContext = createContext<CampusRunStatusRuntime | null>(null);

export function CampusRunStatusRuntimeProvider({
	children,
	runtime,
}: PropsWithChildren<{ runtime: CampusRunStatusRuntime }>) {
	return (
		<CampusRunStatusRuntimeContext.Provider value={runtime}>
			{children}
		</CampusRunStatusRuntimeContext.Provider>
	);
}

function isTerminal(status: CampusRunStatusValue): boolean {
	return TERMINAL_STATUSES.includes(status);
}

function unreachable(value: never): never {
	throw new Error(`Unsupported campus run state: ${String(value)}`);
}

function phaseLabel(phase: CampusRunPhase): string {
	switch (phase) {
		case "queued":
		case "preparing":
			return "正在准备回答";
		case "generating":
			return "正在生成回答";
		case "finalizing":
			return "正在完成回答";
		default:
			return unreachable(phase);
	}
}

function statusLabel(run: CampusRunViewState): string {
	if (run.connection === "disconnected") {
		return "连接已断开";
	}
	switch (run.status) {
		case "queued":
		case "running":
			return phaseLabel(run.phase);
		case "completed":
			return "回答过程";
		case "failed":
			return "回答失败";
		case "cancelled":
			return "已停止回答";
		default:
			return unreachable(run.status);
	}
}

function parseTimestamp(value: string | null): number | null {
	if (!value) {
		return null;
	}
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : null;
}

function padNumber(value: number): string {
	return String(value).padStart(2, "0");
}

export function formatCampusRunTimestamp(
	value: string | null,
	now = new Date(),
	includeSeconds = false,
): string {
	const timestamp = parseTimestamp(value);
	if (timestamp === null) {
		return "未记录";
	}
	const date = new Date(timestamp);
	const clock = `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}${
		includeSeconds ? `:${padNumber(date.getSeconds())}` : ""
	}`;
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (sameDay) {
		return clock;
	}
	if (date.getFullYear() === now.getFullYear()) {
		return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
	}
	return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

function fullLocalTimestamp(value: string | null): string | undefined {
	const timestamp = parseTimestamp(value);
	if (timestamp === null) {
		return undefined;
	}
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "full",
		timeStyle: "medium",
	}).format(new Date(timestamp));
}

function elapsedDurationMs(run: CampusRunViewState, nowMs: number): number | null {
	const acceptedAt = parseTimestamp(run.acceptedAt ?? run.startedAt);
	const completedAt = parseTimestamp(run.completedAt);
	if (acceptedAt !== null) {
		return Math.max(0, (completedAt ?? nowMs) - acceptedAt);
	}
	if (run.durationMs !== null && Number.isFinite(run.durationMs)) {
		return Math.max(0, run.durationMs);
	}
	return null;
}

function summaryTimestamp(run: CampusRunViewState): string | null {
	if (isTerminal(run.status)) {
		return run.completedAt ?? run.startedAt ?? run.acceptedAt;
	}
	return run.startedAt ?? run.acceptedAt;
}

function statusTextClass(run: CampusRunViewState): string {
	if (run.connection === "disconnected" || run.status === "failed") {
		return "text-danger";
	}
	if (run.status === "cancelled") {
		return "text-muted-foreground";
	}
	return "text-muted-foreground group-hover/run-trigger:text-foreground";
}

function RunStatusIcon({ run }: { run: CampusRunViewState }) {
	if (run.connection === "disconnected") {
		return <WifiOffIcon aria-hidden className="size-3.5 shrink-0" />;
	}
	switch (run.status) {
		case "queued":
		case "running":
			return (
				<LoaderCircleIcon
					aria-hidden
					className="motion-safe:animate-spin motion-reduce:animate-none size-3.5 shrink-0"
				/>
			);
		case "completed":
			return <ListTreeIcon aria-hidden className="size-3.5 shrink-0" />;
		case "failed":
			return <CircleAlertIcon aria-hidden className="text-danger size-3.5 shrink-0" />;
		case "cancelled":
			return <XIcon aria-hidden className="size-3.5 shrink-0" />;
		default:
			return unreachable(run.status);
	}
}

function RunSummary({
	run,
	showChevron,
	stepsOpen,
}: {
	run: CampusRunViewState;
	showChevron: boolean;
	stepsOpen: boolean;
}) {
	const timestamp = isTerminal(run.status) ? summaryTimestamp(run) : null;
	const timestampLabel = formatCampusRunTimestamp(timestamp);
	const hasTimestamp = timestamp !== null && parseTimestamp(timestamp) !== null;

	return (
		<>
			<span
				className={cn("flex size-4 shrink-0 items-center justify-center", statusTextClass(run))}
			>
				<RunStatusIcon run={run} />
			</span>
			<span
				aria-atomic="true"
				className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", statusTextClass(run))}
			>
				{statusLabel(run)}
			</span>
			{hasTimestamp ? (
				<span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs tabular-nums">
					<time dateTime={timestamp ?? undefined} title={fullLocalTimestamp(timestamp)}>
						{timestampLabel}
					</time>
				</span>
			) : null}
			{showChevron ? (
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
						stepsOpen && "rotate-90",
					)}
				/>
			) : null}
		</>
	);
}

export function CampusRunDuration({ run }: { run: CampusRunViewState }) {
	const statusRuntime = useContext(CampusRunStatusRuntimeContext);
	const now = statusRuntime?.now ?? Date.now;
	const [nowMs, setNowMs] = useState(() => now());
	const running = !isTerminal(run.status);

	useEffect(() => {
		setNowMs(now());
		if (!running) {
			return;
		}
		const intervalId = globalThis.setInterval(() => setNowMs(now()), 1_000);
		return () => globalThis.clearInterval(intervalId);
	}, [now, running]);

	const durationLabel = formatRunDuration(elapsedDurationMs(run, nowMs));
	if (durationLabel === "未记录") {
		return null;
	}

	return (
		<span
			className="text-muted-foreground shrink-0 text-xs tabular-nums"
			data-slot="campus-run-duration"
		>
			<span className="sr-only">耗时 </span>
			{durationLabel}
		</span>
	);
}

function liveSteps(run: CampusRunViewState): readonly ChatRunStep[] {
	return [
		{
			completedAt: null,
			durationMs: null,
			phase: run.phase,
			startedAt: null,
			status:
				run.status === "failed" ? "failed" : run.status === "cancelled" ? "cancelled" : "running",
		},
	];
}

type StepsState =
	| { kind: "idle"; steps: readonly ChatRunStep[] }
	| { kind: "loading"; steps: readonly ChatRunStep[] }
	| { error: string; kind: "error"; steps: readonly ChatRunStep[] }
	| { kind: "ready"; steps: readonly ChatRunStep[] };

function RunStepsLoading() {
	return (
		<div
			aria-busy="true"
			aria-label="正在加载回答过程"
			className="flex flex-col gap-2 py-1"
			role="status"
		>
			{CAMPUS_RUN_STEP_PHASES.map((phase) => (
				<div className="flex items-center gap-2" key={phase}>
					<span className="bg-surface-muted size-3.5 animate-pulse rounded-full motion-reduce:animate-none" />
					<span className="bg-surface-muted h-3.5 max-w-40 flex-1 animate-pulse rounded motion-reduce:animate-none" />
				</div>
			))}
		</div>
	);
}

export function CampusRunStatus({
	defaultStepsOpen = false,
	run,
}: {
	defaultStepsOpen?: boolean;
	run: CampusRunViewState;
}) {
	const aui = useAui();
	const statusRuntime = useContext(CampusRunStatusRuntimeContext);
	const [stepsOpen, setStepsOpen] = useState(() => defaultStepsOpen);
	const [stepsState, setStepsState] = useState<StepsState>({ kind: "idle", steps: [] });
	const [isResuming, setIsResuming] = useState(false);
	const [resumeError, setResumeError] = useState<string | null>(null);
	const requestControllerRef = useRef<AbortController | null>(null);
	const renderedRunIdRef = useRef(run.runId);
	const wasTerminalRef = useRef(isTerminal(run.status));

	const running = !isTerminal(run.status);
	const hasRunId = Boolean(run.runId);

	useEffect(() => {
		if (renderedRunIdRef.current === run.runId) {
			return;
		}
		renderedRunIdRef.current = run.runId;
		requestControllerRef.current?.abort();
		requestControllerRef.current = null;
		setStepsOpen(defaultStepsOpen);
		setStepsState({ kind: "idle", steps: [] });
		setResumeError(null);
	}, [defaultStepsOpen, run.runId]);

	useEffect(() => {
		const terminal = isTerminal(run.status);
		if (terminal && !wasTerminalRef.current) {
			setStepsOpen(false);
		}
		wasTerminalRef.current = terminal;
	}, [run.status]);

	useEffect(
		() => () => {
			requestControllerRef.current?.abort();
		},
		[],
	);

	const loadSteps = useCallback(async () => {
		if (!run.runId || stepsState.kind === "loading") {
			return;
		}
		requestControllerRef.current?.abort();
		const controller = new AbortController();
		requestControllerRef.current = controller;
		setStepsState((current) => ({ kind: "loading", steps: current.steps }));
		try {
			const result = statusRuntime
				? await statusRuntime.loadSteps({ runId: run.runId, signal: controller.signal })
				: await getRunSteps({ runId: run.runId, signal: controller.signal });
			if (!controller.signal.aborted) {
				setStepsState({ kind: "ready", steps: result.steps });
			}
		} catch (error) {
			if (controller.signal.aborted) {
				return;
			}
			setStepsState((current) => ({
				error: error instanceof Error ? error.message : "回答过程暂时无法加载。",
				kind: "error",
				steps: current.steps,
			}));
		} finally {
			if (requestControllerRef.current === controller) {
				requestControllerRef.current = null;
			}
		}
	}, [run.runId, statusRuntime, stepsState.kind]);

	const handleStepsOpenChange = useCallback(
		(open: boolean) => {
			setStepsOpen(open);
			if (
				open &&
				isTerminal(run.status) &&
				(stepsState.kind === "idle" || stepsState.kind === "error")
			) {
				void loadSteps();
			}
		},
		[loadSteps, run.status, stepsState.kind],
	);

	const retrySteps = useCallback(() => {
		void loadSteps();
	}, [loadSteps]);

	useEffect(() => {
		if (!(defaultStepsOpen && isTerminal(run.status)) || stepsState.kind !== "idle") {
			return;
		}
		void loadSteps();
	}, [defaultStepsOpen, loadSteps, run.status, stepsState.kind]);

	const resume = useCallback(async () => {
		if (!run.runId || isResuming) {
			return;
		}
		setIsResuming(true);
		setResumeError(null);
		try {
			if (statusRuntime) {
				await statusRuntime.resume();
			} else {
				await aui.thread.resumeRun({ parentId: null });
			}
		} catch {
			setResumeError("恢复连接失败，请稍后重试。");
		} finally {
			setIsResuming(false);
		}
	}, [aui.thread, isResuming, run.runId, statusRuntime]);

	const showResume = run.connection === "disconnected" && running && hasRunId;
	const displayedSteps = running ? liveSteps(run) : stepsState.steps;

	return (
		<section
			aria-label="回答进度"
			className="mb-2 w-full max-w-[42rem] text-sm"
			data-connection={run.connection}
			data-run-status={run.status}
			data-slot="campus-run-status"
		>
			<Collapsible open={stepsOpen} onOpenChange={handleStepsOpenChange}>
				<div className="flex min-h-7 min-w-0 items-center gap-1">
					{hasRunId ? (
						<CollapsibleTrigger asChild>
							<button
								className="group/run-trigger hover:bg-surface-muted/55 focus-visible:bg-surface-muted/55 -ms-1 flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border-0 bg-transparent px-1 py-0.5 text-left outline-none transition-colors active:translate-y-px motion-reduce:transition-none"
								type="button"
							>
								<span className="sr-only">{stepsOpen ? "收起回答过程" : "查看回答过程"}，</span>
								<RunSummary run={run} showChevron stepsOpen={stepsOpen} />
							</button>
						</CollapsibleTrigger>
					) : (
						<div className="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 py-0.5">
							<RunSummary run={run} showChevron={false} stepsOpen={false} />
						</div>
					)}
					{showResume ? (
						<Button
							aria-busy={isResuming}
							className="h-7 shrink-0 px-2 text-xs"
							disabled={isResuming}
							onClick={() => void resume()}
							variant="ghost"
						>
							<RefreshCwIcon
								aria-hidden
								className={cn(
									"size-3.5",
									isResuming && "motion-safe:animate-spin motion-reduce:animate-none",
								)}
							/>
							{isResuming ? "恢复中" : "重新连接"}
						</Button>
					) : null}
				</div>

				{resumeError ? <p className="text-danger ms-5 mt-1 text-xs">{resumeError}</p> : null}

				{hasRunId ? (
					<CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
						<div className="border-border/70 ms-2 mt-1 border-s ps-4 pb-1">
							{!running && stepsState.kind === "loading" ? (
								<RunStepsLoading />
							) : (
								<CampusRunSteps
									error={stepsState.kind === "error" ? "回答过程暂时无法加载。" : null}
									onRetry={stepsState.kind === "error" ? retrySteps : undefined}
									steps={displayedSteps}
								/>
							)}
						</div>
					</CollapsibleContent>
				) : null}
			</Collapsible>
		</section>
	);
}
