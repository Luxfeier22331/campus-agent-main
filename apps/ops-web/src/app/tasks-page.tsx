import {
	Alert,
	Badge,
	Button,
	Checkbox,
	ConfirmDialog,
	Disclosure,
	DisclosureSummary,
	Field,
	Label,
	StateMessage,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { OpsTask, TaskScheduleInput } from "../shared/tasks-contract";
import { formatTimestamp } from "./format";
import { PageHeader } from "./ops-display";
import { FilterSelect } from "./ui/filter-select";
import { useConfirmCommand } from "./use-confirm-command";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`/api/ops/tasks${path}`, init);
	const result = await response.json();
	if (!response.ok) {
		throw new Error(result.message ?? result.error?.message ?? "任务请求失败");
	}
	return result as T;
}
export function TasksPage() {
	const query = useQuery({
		queryKey: ["ops-tasks"],
		queryFn: ({ signal }) => request<{ tasks: OpsTask[] }>("", { signal }),
		refetchInterval: (query) =>
			query.state.data?.tasks.some((task) => task.running)
				? 3000
				: query.state.data?.tasks.some((task) => task.enabled)
					? 30_000
					: false,
		refetchIntervalInBackground: false,
	});
	return (
		<section>
			<PageHeader
				title="定时任务"
				description="管理自动调度、手动执行和最近运行结果。暂停后，正在运行的任务会继续完成。"
			/>
			{query.error && (
				<StateMessage
					layout="inline"
					tone="danger"
					role="alert"
					description={query.error.message}
				/>
			)}
			{query.isPending && <StateMessage layout="inline" description={<>正在读取任务…</>} />}
			{query.data?.tasks.length === 0 ? (
				<StateMessage description="当前没有可管理的任务。" />
			) : null}
			<div className="grid items-start gap-5 xl:grid-cols-2">
				{query.data?.tasks.map((task) => (
					<TaskCard key={task.id} task={task} />
				))}
			</div>
		</section>
	);
}
function TaskCard({ task }: { task: OpsTask }) {
	const client = useQueryClient();
	const confirmCommand = useConfirmCommand();
	const [notice, setNotice] = useState("");
	const [draft, setDraft] = useState<TaskScheduleInput | null>(null);
	const value = draft ?? {
		enabled: task.enabled ?? false,
		intervalMinutes: ([15, 30, 60].includes(task.intervalMinutes ?? 0)
			? task.intervalMinutes
			: 60) as 15 | 30 | 60,
	};
	const save = useMutation({
		mutationFn: (value: TaskScheduleInput) =>
			request(`/${task.id}/schedule`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(value),
			}),
		onSuccess: async () => {
			setDraft(null);
			setNotice("调度设置已保存。");
			await client.invalidateQueries({ queryKey: ["ops-tasks"] });
		},
	});
	const rollback = useMutation({
		mutationFn: () => request("/notice-pipeline/rollback", { method: "POST" }),
		onSuccess: async () => {
			setNotice("索引回滚任务已提交，执行结果见最近运行。");
			await client.invalidateQueries({ queryKey: ["ops-tasks"] });
		},
	});
	const run = useMutation({
		mutationFn: () => request(`/${task.id}/runs`, { method: "POST" }),
		onSuccess: async () => {
			setNotice("运行任务已提交。");
			await client.invalidateQueries({ queryKey: ["ops-tasks"] });
		},
	});
	return (
		<section
			className="min-w-0 space-y-4 rounded-lg border border-border bg-background p-4 sm:p-5"
			aria-label={task.label}
		>
			<h2 className="text-lg font-medium">{task.label}</h2>
			<p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<Badge tone={task.running ? "info" : task.enabled ? "success" : "neutral"}>
					{task.running
						? "运行中"
						: task.enabled === null
							? "调度状态未知"
							: task.enabled
								? "自动运行已开启"
								: "已暂停"}
				</Badge>
				· {task.schedule ?? "无可用周期"}
			</p>
			{task.error && (
				<Alert tone="danger">
					<p className="text-sm">无法读取{task.label}的调度或运行记录。</p>
					<Disclosure className="mt-2 text-xs">
						<DisclosureSummary>技术信息</DisclosureSummary>
						<pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words">
							{task.error}
						</pre>
					</Disclosure>
				</Alert>
			)}
			{task.canSchedule && (
				<form
					className="flex flex-wrap items-end gap-3 border-y border-border py-3"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate(value);
					}}
				>
					<h3 className="w-full ui-section-title">调度设置</h3>
					<Label className="flex min-h-11 items-center gap-2" htmlFor={`${task.id}-enabled`}>
						<Checkbox
							id={`${task.id}-enabled`}
							checked={value.enabled}
							onCheckedChange={(checked) => setDraft({ ...value, enabled: checked === true })}
						/>{" "}
						自动运行
					</Label>
					<Field label="周期">
						<FilterSelect
							id={`${task.id}-interval`}
							value={String(value.intervalMinutes)}
							onValueChange={(nextValue) =>
								setDraft({ ...value, intervalMinutes: Number(nextValue) as 15 | 30 | 60 })
							}
							options={[15, 30, 60].map((n) => ({ value: String(n), label: `${n} 分钟` }))}
						/>
					</Field>
					<Button type="submit" disabled={save.isPending || task.enabled === null}>
						{save.isPending ? "保存中…" : "保存设置"}
					</Button>
				</form>
			)}
			{task.canRun && (
				<Button
					type="button"
					variant="secondary"
					disabled={task.running || run.isPending}
					onClick={() => {
						setNotice("");
						run.mutate();
					}}
				>
					立即运行一次
				</Button>
			)}
			{task.id === "notice-pipeline" && (
				<div className="border-t border-border pt-4">
					<ConfirmDialog
						title="暂停调度并回滚索引？"
						description="暂停通知流水线的后续调度，并提交索引回滚任务，回到已验证的上一版本。正在运行的任务会继续完成。"
						confirmLabel="提交索引回滚"
						{...confirmCommand("rollback", () => {
							setNotice("");
							return rollback.mutateAsync();
						})}
						trigger={<Button variant="destructive">暂停调度并回滚索引</Button>}
					/>
				</div>
			)}
			{(save.error || run.error) && (
				<StateMessage
					layout="inline"
					tone="danger"
					role="alert"
					description={(save.error ?? run.error)?.message}
				/>
			)}
			{notice ? <StateMessage layout="inline" role="status" description={notice} /> : null}
			<h3 className="ui-section-title">最近运行</h3>
			{task.runs.length === 0 ? (
				<StateMessage layout="inline" description="暂无运行记录。" />
			) : null}
			{task.runs.map((item) => (
				<Disclosure className="border-t border-border pt-3 text-sm" key={item.id}>
					<DisclosureSummary className="break-words text-muted-foreground">
						{formatTimestamp(item.startedAt)} · {item.status} · 业务结果：
						{
							{
								success: "成功",
								partial: "部分失败",
								failed: "失败",
								skipped: "跳过",
								unknown: "未知",
							}[item.outcome]
						}
					</DisclosureSummary>
					<pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
						{JSON.stringify(item.details, null, 2)}
					</pre>
					{item.error && (
						<StateMessage layout="inline" tone="danger" role="alert" description={item.error} />
					)}
				</Disclosure>
			))}
		</section>
	);
}
