import type { OcrTask } from "@campus-agent/document-ocr";
import {
	Button,
	Card,
	CardContent,
	ConfirmDialog,
	Field,
	Input,
	StateMessage,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { type OcrResourceWithNotice, OcrResourceWithNoticeSchema } from "../shared/ocr-contract";
import type { OpsTask } from "../shared/tasks-contract";
import { formatTimestamp } from "./format";
import { OcrHistory, ocrStatusLabels } from "./ocr-history";
import { OcrResultDialog } from "./ocr-result-dialog";
import { fetchJson } from "./ops-api/core";
import { ErrorState, PageHeader } from "./ops-display";
import { useConfirmCommand } from "./use-confirm-command";

const tasksKey = ["ocr", "tasks"] as const;
const statusLabels: Record<OcrTask["status"], string> = {
	pending: "等待处理",
	submitting: "正在上传",
	submitted: "正在识别",
	completed: "已完成",
	failed: "失败",
};
async function post(path: string, body?: unknown) {
	const result = (await fetchJson(path, {
		method: "POST",
		...(body
			? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
			: {}),
	})) as { launchError?: string | null; tasks?: OcrTask[] };
	return result;
}
export function OcrPage() {
	const client = useQueryClient();
	const [noticeId, setNoticeId] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const confirmCommand = useConfirmCommand();
	const from = useRouterState({ select: (state) => state.location.href });
	const [message, setMessage] = useState("");
	const tasks = useQuery({
		queryKey: tasksKey,
		queryFn: async ({ signal }) => {
			const data = (await fetchJson("/api/ops/ocr/tasks", { signal })) as {
				tasks: OcrTask[];
				images: OcrResourceWithNotice[];
			};
			return {
				...data,
				images: data.images.map((resource) => OcrResourceWithNoticeSchema.parse(resource)),
			};
		},
		refetchInterval: (query) =>
			query.state.data &&
			[
				...query.state.data.tasks,
				...query.state.data.images.flatMap((resource) => resource.batches),
			].some((t) => !["completed", "failed"].includes(t.status))
				? 5000
				: false,
	});
	const create = useMutation({
		mutationFn: () => post("/api/ops/ocr/tasks", { noticeId }),
		onSuccess: async (result) => {
			setMessage(
				result.launchError
					? `任务已保存，但启动失败：${result.launchError}。可点击“恢复”。`
					: result.tasks?.length === 0
						? "该通知没有可识别的正文图片或 PDF 附件。"
						: "识别任务已提交。",
			);
			await Promise.all([
				client.invalidateQueries({ queryKey: tasksKey }),
				client.invalidateQueries({ queryKey: ["ocr", "notice"] }),
			]);
		},
	});
	const action = useMutation({
		mutationFn: ({ id, action }: { id: string; action: "resume" | "rerun" }) =>
			post(`/api/ops/ocr/tasks/${id}/${action}`),
		onSuccess: async (result) => {
			setMessage(result.launchError ? `启动失败：${result.launchError}` : "任务已提交。");
			await Promise.all([
				client.invalidateQueries({ queryKey: tasksKey }),
				client.invalidateQueries({ queryKey: ["ocr", "notice"] }),
			]);
		},
	});
	const schedule = useQuery({
		queryKey: ["ops-tasks"],
		queryFn: ({ signal }) =>
			fetchJson("/api/ops/tasks", { signal }) as Promise<{ tasks: OpsTask[] }>,
	});
	const ocrSchedule = schedule.data?.tasks.find((task) => task.id === "document-ocr");
	const otherTasks =
		tasks.data?.tasks.filter(
			(task) =>
				task.input.kind !== "source" ||
				(task.input.resource?.kind !== "attachment" &&
					!(
						task.input.contentType.startsWith("image/") ||
						task.input.resource?.kind === "image" ||
						task.input.key.includes("/images/")
					)),
		) ?? [];

	return (
		<section className="space-y-4">
			<PageHeader
				title="文档识别"
				description="识别已采集通知中的正文图片和 PDF 附件，查看或恢复处理任务。"
			/>
			<Card className="border-border shadow-none" aria-label="发起识别">
				<CardContent className="p-4">
					<form
						className="grid items-end gap-3 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]"
						onSubmit={(e) => {
							e.preventDefault();
							create.mutate();
						}}
					>
						<div className="space-y-1">
							<Field label="通知 ID" id="ocr-notice">
								<Input
									id="ocr-notice"
									inputMode="numeric"
									pattern="[1-9][0-9]*"
									required
									value={noticeId}
									onChange={(e) => setNoticeId(e.target.value)}
								/>
							</Field>
						</div>
						<Button disabled={create.isPending} type="submit">
							{create.isPending ? "提交中…" : "识别通知文档"}
						</Button>
						<Button type="button" variant="ghost" onClick={() => void tasks.refetch()}>
							刷新
						</Button>
					</form>
					{message ? (
						<StateMessage layout="inline" role="status" className="mt-3" description={message} />
					) : null}
					{create.isError ? (
						<StateMessage
							layout="inline"
							role="alert"
							tone="danger"
							className="mt-3"
							description={create.error?.message}
						/>
					) : null}
				</CardContent>
			</Card>
			<div className="flex flex-wrap gap-2 text-sm">
				<span>
					{schedule.isPending
						? "正在读取自动识别调度…"
						: schedule.isError || ocrSchedule?.error
							? "自动识别调度读取失败"
							: ocrSchedule?.enabled === true
								? "自动识别已开启"
								: ocrSchedule?.enabled === false
									? "自动识别已暂停"
									: "自动识别调度未提供"}
				</span>
				<Link to="/tasks" className="text-info underline">
					查看定时任务
				</Link>
			</div>
			<h2 className="ui-section-title">通知文档 · 最近 100 组</h2>
			{tasks.data?.images.length === 0 ? (
				<StateMessage description="暂无图片或 PDF 附件识别记录。" />
			) : null}
			<ul className="grid gap-3">
				{tasks.data?.images.map((resource) => {
					const latest = resource.batches[0];
					const selectedResult = resource.batches.find(
						(batch) => batch.id === resource.selectedResultId,
					);
					return (
						<li
							key={JSON.stringify([resource.noticeId, resource.sourceKey])}
							className="min-w-0 rounded-lg border p-4"
						>
							<Link
								to="/notices"
								search={{ q: resource.noticeId, from }}
								className="text-info underline"
							>
								通知 {resource.noticeId} · {resource.label}
							</Link>
							<p className="mt-2 text-sm">
								当前结果：
								{selectedResult ? `可用 · ${selectedResult.pageCount} 页` : "暂无可用文本"}
							</p>
							<p className="text-sm">
								最新尝试：{latest ? ocrStatusLabels[latest.status] : "未识别"}
							</p>
							{latest?.error ? (
								<p className="whitespace-pre-wrap break-words text-sm text-danger">
									{latest.error}
								</p>
							) : null}
							<div className="mt-2 flex flex-wrap gap-2">
								{selectedResult ? (
									<Button size="sm" variant="ghost" onClick={() => setSelected(selectedResult.id)}>
										查看结果
									</Button>
								) : null}
								{latest?.canResume ? (
									<Button
										size="sm"
										variant="secondary"
										disabled={action.isPending}
										onClick={() => action.mutate({ id: latest.id, action: "resume" })}
									>
										恢复
									</Button>
								) : null}
								{latest && ["completed", "failed"].includes(latest.status) ? (
									<ConfirmDialog
										title="重新识别？"
										description="这会再次调用 Paddle 并产生用量，现有结果仍会保留。"
										confirmLabel="确认重新识别"
										confirmVariant="primary"
										{...confirmCommand(latest.id, () =>
											action.mutateAsync({ id: latest.id, action: "rerun" }),
										)}
										trigger={
											<Button size="sm" variant="secondary" disabled={action.isPending}>
												重新识别
											</Button>
										}
									/>
								) : null}
							</div>
							{action.isError && action.variables?.id === latest?.id ? (
								<ErrorState error={action.error} title="识别任务提交失败" />
							) : null}
							<OcrHistory resource={resource} onResult={setSelected} />
						</li>
					);
				})}
			</ul>
			{tasks.isPending ? (
				<StateMessage layout="inline" role="status" description={<> 正在读取任务… </>} />
			) : null}
			{tasks.isError ? (
				<ErrorState error={tasks.error} onRetry={() => tasks.refetch()} title="识别任务读取失败" />
			) : null}
			{tasks.data?.tasks.length === 0 && tasks.data.images.length === 0 ? (
				<StateMessage description="还没有识别任务。输入通知 ID 开始识别。" />
			) : null}
			{otherTasks.length > 0 ? (
				<div className="ops-ocr-tasks min-w-0 max-w-full overflow-x-auto rounded-lg border border-border">
					<Table className="w-full text-left text-sm">
						<TableHeader className="bg-muted">
							<TableRow>
								<TableHead className="p-3">来源</TableHead>
								<TableHead className="p-3">状态</TableHead>
								<TableHead className="p-3">页数</TableHead>
								<TableHead className="p-3">操作</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{otherTasks.map((task) => (
								<TableRow key={task.id} className="border-t align-top">
									<TableCell className="p-3">
										{task.input.kind === "validation"
											? "模型连接验证"
											: task.input.kind === "source"
												? `通知 ${task.input.noticeId} · ${task.input.resource?.kind === "attachment" ? "PDF 附件" : "其他资源"}`
												: "本地上传文件"}
										<div className="text-xs text-muted-foreground">
											{formatTimestamp(task.createdAt)}
										</div>
									</TableCell>
									<TableCell className="max-w-sm p-3">
										{statusLabels[task.status]}
										{action.isError &&
										action.variables?.id === task.id &&
										action.variables.action === "resume" ? (
											<StateMessage
												layout="inline"
												tone="danger"
												role="alert"
												description={action.error.message}
											/>
										) : null}
										{task.error ? (
											<p className="mt-1 break-words text-destructive">{task.error}</p>
										) : null}
									</TableCell>
									<TableCell className="p-3">
										<span className="text-muted-foreground md:hidden">页数 / 进度：</span>
										{task.result
											? task.pageCount
											: task.progress?.totalPages
												? `${task.progress.extractedPages ?? 0} / ${task.progress.totalPages}`
												: "—"}
									</TableCell>
									<TableCell className="flex flex-wrap gap-2 p-3">
										{task.result ? (
											<Button size="sm" variant="ghost" onClick={() => setSelected(task.id)}>
												查看结果
											</Button>
										) : null}
										{task.status !== "completed" &&
										(task.status !== "failed" || task.providerJobId) ? (
											<Button
												size="sm"
												variant="secondary"
												disabled={action.isPending}
												onClick={() => action.mutate({ id: task.id, action: "resume" })}
											>
												恢复
											</Button>
										) : null}
										{["completed", "failed"].includes(task.status) ? (
											<ConfirmDialog
												title="重新识别？"
												description="这会再次调用 Paddle 并产生用量，现有结果仍会保留。"
												confirmLabel="确认重新识别"
												confirmVariant="primary"
												{...confirmCommand(task.id, () =>
													action.mutateAsync({ id: task.id, action: "rerun" }),
												)}
												trigger={
													<Button size="sm" variant="secondary" disabled={action.isPending}>
														重新识别
													</Button>
												}
											/>
										) : null}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			) : null}
			<OcrResultDialog
				url={selected ? `/api/ops/ocr/tasks/${selected}/result` : null}
				onClose={() => setSelected(null)}
			/>
		</section>
	);
}
