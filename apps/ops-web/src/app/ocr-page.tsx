import type { OcrTask } from "@campus-agent/document-ocr";
import {
	Button,
	Card,
	CardContent,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogTitle,
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
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { formatTimestamp } from "./format";
import { fetchJson } from "./ops-api/core";
import { ErrorState, PageHeader } from "./ops-display";
import { FilterSelect } from "./ui/filter-select";
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
	const pageTarget = useRef<HTMLElement | null>(null);
	const [message, setMessage] = useState("");
	const tasks = useQuery({
		queryKey: tasksKey,
		queryFn: ({ signal }) =>
			fetchJson("/api/ops/ocr/tasks", { signal }) as Promise<{ tasks: OcrTask[] }>,
		refetchInterval: (query) =>
			query.state.data?.tasks.some((t) => !["completed", "failed"].includes(t.status))
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
						? "该通知没有可识别的图片或 PDF。"
						: "识别任务已提交。",
			);
			await client.invalidateQueries({ queryKey: tasksKey });
		},
	});
	const action = useMutation({
		mutationFn: ({ id, action }: { id: string; action: "resume" | "rerun" }) =>
			post(`/api/ops/ocr/tasks/${id}/${action}`),
		onSuccess: async (result) => {
			setMessage(result.launchError ? `启动失败：${result.launchError}` : "任务已提交。");
			await client.invalidateQueries({ queryKey: tasksKey });
		},
	});
	const result = useQuery({
		queryKey: ["ocr", "result", selected],
		queryFn: ({ signal }) =>
			fetchJson(`/api/ops/ocr/tasks/${selected}/result`, { signal }) as Promise<{
				pages: { index: number; markdown: string }[];
				missingImages: string[];
			}>,
		enabled: selected !== null,
	});
	return (
		<section className="space-y-4">
			<PageHeader
				title="文档识别"
				description="识别已采集通知中的图片和 PDF，查看或恢复处理任务。"
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
							{create.isPending ? "提交中…" : "识别通知附件"}
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
			<h2 className="ui-section-title">识别任务</h2>
			{tasks.isPending ? (
				<StateMessage layout="inline" role="status" description={<> 正在读取任务… </>} />
			) : null}
			{tasks.isError ? (
				<ErrorState error={tasks.error} onRetry={() => tasks.refetch()} title="识别任务读取失败" />
			) : null}
			{tasks.data?.tasks.length === 0 ? (
				<StateMessage description="还没有识别任务。输入通知 ID 开始识别。" />
			) : null}
			{tasks.data && tasks.data.tasks.length > 0 ? (
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
							{tasks.data.tasks.map((task) => (
								<TableRow key={task.id} className="border-t align-top">
									<TableCell className="p-3">
										{task.input.kind === "validation"
											? "模型连接验证"
											: task.input.kind === "source"
												? `通知 ${task.input.noticeId} · ${task.input.key.includes("/images/") ? "图片" : "附件"} ${Number(task.input.key.split("/").at(-1)) + 1}`
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
			<Dialog
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) {
						setSelected(null);
					}
				}}
			>
				<DialogContent
					className="max-h-[85vh] overflow-y-auto sm:max-w-5xl"
					aria-describedby={undefined}
				>
					<DialogTitle>识别结果</DialogTitle>
					{result.isPending ? <StateMessage layout="inline" description="正在读取结果…" /> : null}
					{result.isError ? (
						<ErrorState
							error={result.error}
							onRetry={() => result.refetch()}
							title="结果读取失败"
						/>
					) : null}
					{result.data && result.data.missingImages.length > 0 ? (
						<p>历史结果中有 {result.data.missingImages.length} 张图片未能下载；文字已保留。</p>
					) : null}
					{result.data && result.data.pages.length > 1 ? (
						<div className="sticky top-0 z-10 border-b border-border bg-background py-2">
							<Field label={`跳转页码（共 ${result.data.pages.length} 页）`}>
								<FilterSelect
									value=""
									onCloseAutoFocus={(event) => {
										const target = pageTarget.current;
										if (target) {
											event.preventDefault();
											target.focus({ preventScroll: true });
											target.scrollIntoView({ block: "start" });
											pageTarget.current = null;
										}
									}}
									onValueChange={(value) => {
										const target = document.getElementById(`ocr-result-page-${value}`);
										pageTarget.current = target;
										target?.focus({ preventScroll: true });
										target?.scrollIntoView({ block: "start" });
									}}
									options={[
										{ value: "", label: "选择页码" },
										...result.data.pages.map((page) => ({
											value: String(page.index),
											label: `第 ${page.index + 1} 页`,
										})),
									]}
								/>
							</Field>
						</div>
					) : null}
					{result.data?.pages.map((page) => (
						<article
							id={`ocr-result-page-${page.index}`}
							key={page.index}
							tabIndex={-1}
							className="scroll-mt-24 space-y-3 overflow-auto border-t pt-4"
						>
							<h3 className="text-sm text-muted-foreground">第 {page.index + 1} 页</h3>
							<div className="prose max-w-none dark:prose-invert [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									rehypePlugins={[rehypeRaw, rehypeSanitize]}
									components={{
										img: ({ src, alt }) =>
											src?.startsWith("/api/ops/ocr/tasks/") ? (
												<img src={src} alt={alt ?? ""} />
											) : null,
									}}
								>
									{page.markdown}
								</ReactMarkdown>
							</div>
						</article>
					))}
				</DialogContent>
			</Dialog>
		</section>
	);
}
