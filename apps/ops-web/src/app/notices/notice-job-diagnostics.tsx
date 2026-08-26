import type { NoticeJob } from "../../shared/ops-contract";

const PHASE_LABELS: Record<NonNullable<NoticeJob["progress"]>["phase"], string> = {
	finalizing: "收尾",
	processing: "处理",
	scanning: "扫描",
	writing: "写入",
};

export function NoticeJobDiagnostics({ job }: { job: NoticeJob }) {
	const progress = job.progress;
	if (!(job.range || progress || job.error || job.controllerError)) {
		return null;
	}
	return (
		<div className="mt-2 grid gap-2 text-xs">
			{job.range ? (
				<p className="text-muted-foreground">
					维护区间 [{job.range.from}, {job.range.to})
				</p>
			) : null}
			{progress ? <ProgressView progress={progress} /> : null}
			{job.error ? (
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-danger/10 p-2 font-mono text-danger">
					{job.error}
				</pre>
			) : null}
			{job.controllerError ? (
				<p className="whitespace-pre-wrap break-words rounded-md bg-warning/10 p-2 text-warning">
					Kubernetes 控制器：{job.controllerError}
				</p>
			) : null}
		</div>
	);
}

function ProgressView({ progress }: { progress: NonNullable<NoticeJob["progress"]> }) {
	const total = progress.total;
	return (
		<div className="grid gap-1">
			<div className="flex items-center justify-between gap-3 text-muted-foreground">
				<span>阶段：{PHASE_LABELS[progress.phase]}</span>
				<span className="font-mono">
					{progress.processed}
					{total === null ? "" : ` / ${total}`}
				</span>
			</div>
			{total === null ? null : (
				<progress
					aria-label="任务进度"
					className="h-1.5 w-full accent-[var(--sys-border-selected)]"
					max={Math.max(total, 1)}
					value={Math.min(progress.processed, total)}
				/>
			)}
		</div>
	);
}
