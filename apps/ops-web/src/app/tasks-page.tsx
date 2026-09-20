import { Button, Checkbox, NativeSelect } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { OpsTask, TaskScheduleInput } from "../shared/tasks-contract";

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
		<main className="space-y-5 p-6">
			<h1 className="text-2xl font-semibold">定时任务</h1>
			<p>暂停后不再启动新任务，正在运行的任务会继续完成。</p>
			{query.error && <p role="alert">{query.error.message}</p>}
			{query.isPending && <p>正在读取任务…</p>}
			{query.data?.tasks.map((task) => (
				<TaskCard key={task.id} task={task} />
			))}
		</main>
	);
}
function TaskCard({ task }: { task: OpsTask }) {
	const client = useQueryClient();
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
			await client.invalidateQueries({ queryKey: ["ops-tasks"] });
		},
	});
	const rollback = useMutation({
		mutationFn: () => request("/campus-rag-refresh/rollback", { method: "POST" }),
		onSuccess: () => client.invalidateQueries({ queryKey: ["ops-tasks"] }),
	});
	const run = useMutation({
		mutationFn: () => request(`/${task.id}/runs`, { method: "POST" }),
		onSuccess: () => client.invalidateQueries({ queryKey: ["ops-tasks"] }),
	});
	return (
		<section className="space-y-3 rounded border p-4" aria-label={task.label}>
			<h2 className="text-lg font-medium">{task.label}</h2>
			<p>
				{task.running
					? "运行中"
					: task.enabled === null
						? "调度状态未知"
						: task.enabled
							? "自动运行已开启"
							: "已暂停"}{" "}
				· {task.schedule ?? "无可用周期"}
			</p>
			{task.problemCount !== null && (
				<p>
					待处理问题：{task.problemCount} 条 ·{" "}
					<a
						className="underline"
						href={`/notices?issueStage=${task.id === "notice-classifier" ? "classification" : "publication"}`}
					>
						打开通知维护
					</a>
				</p>
			)}
			{task.error && <p role="alert">{task.error}</p>}
			{task.canSchedule && (
				<form
					className="flex flex-wrap items-center gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate(value);
					}}
				>
					<label htmlFor={`${task.id}-enabled`}>
						<Checkbox
							id={`${task.id}-enabled`}
							checked={value.enabled}
							onCheckedChange={(checked) => setDraft({ ...value, enabled: checked === true })}
						/>{" "}
						自动运行
					</label>
					<label htmlFor={`${task.id}-interval`}>
						周期{" "}
						<NativeSelect
							id={`${task.id}-interval`}
							value={value.intervalMinutes}
							onChange={(event) =>
								setDraft({ ...value, intervalMinutes: Number(event.target.value) as 15 | 30 | 60 })
							}
						>
							{[15, 30, 60].map((n) => (
								<option key={n} value={n}>
									{n} 分钟
								</option>
							))}
						</NativeSelect>
					</label>
					<Button type="submit" disabled={save.isPending || task.enabled === null}>
						保存设置
					</Button>
				</form>
			)}
			{task.canRun && (
				<Button type="button" disabled={task.running || run.isPending} onClick={() => run.mutate()}>
					立即运行一次
				</Button>
			)}
			{task.id === "campus-rag-refresh" && (
				<Button type="button" disabled={rollback.isPending} onClick={() => rollback.mutate()}>
					暂停并回滚至上一版本
				</Button>
			)}
			{(save.error || run.error || rollback.error) && (
				<p role="alert">{(save.error ?? run.error ?? rollback.error)?.message}</p>
			)}
			{task.runs.map((item) => (
				<details key={item.id}>
					<summary>
						{item.startedAt} · {item.status} · 业务结果：
						{
							{
								success: "成功",
								partial: "部分失败",
								failed: "失败",
								skipped: "跳过",
								unknown: "未知",
							}[item.outcome]
						}
					</summary>
					<pre className="overflow-auto whitespace-pre-wrap">
						{JSON.stringify(item.details, null, 2)}
					</pre>
					{item.error && <p role="alert">{item.error}</p>}
				</details>
			))}
		</section>
	);
}
