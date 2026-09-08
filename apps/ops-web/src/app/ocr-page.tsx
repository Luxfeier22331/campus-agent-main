import type { OcrTask } from "@campus-agent/document-ocr";
import {
	Button,
	Card,
	CardContent,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
	Input,
	Label,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { fetchJson } from "./ops-api/core";
import { ErrorState, PageHeader } from "./ops-display";

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
	const [rerunId, setRerunId] = useState<string | null>(null);
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
			<Card>
				<CardContent className="p-4">
					<form
						className="flex flex-wrap items-end gap-3"
						onSubmit={(e) => {
							e.preventDefault();
							create.mutate();
						}}
					>
						<div className="space-y-1">
							<Label htmlFor="ocr-notice">通知 ID</Label>
							<Input
								id="ocr-notice"
								inputMode="numeric"
								pattern="[1-9][0-9]*"
								required
								value={noticeId}
								onChange={(e) => setNoticeId(e.target.value)}
							/>
						</div>
						<Button disabled={create.isPending} type="submit">
							{create.isPending ? "提交中…" : "识别通知附件"}
						</Button>
						<Button type="button" variant="outline" onClick={() => void tasks.refetch()}>
							刷新
						</Button>
					</form>
					{message ? (
						<p role="status" className="mt-3 text-sm">
							{message}
						</p>
					) : null}
					{create.isError || action.isError ? (
						<p role="alert" className="mt-3 text-destructive">
							{(create.error ?? action.error)?.message}
						</p>
					) : null}
				</CardContent>
			</Card>
			{tasks.isPending ? <p role="status">正在读取任务…</p> : null}
			{tasks.isError ? (
				<ErrorState error={tasks.error} onRetry={() => tasks.refetch()} title="识别任务读取失败" />
			) : null}
			{tasks.data?.tasks.length === 0 ? <p>还没有识别任务。输入通知 ID 开始识别。</p> : null}
			{tasks.data && tasks.data.tasks.length > 0 ? (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-left text-sm">
						<thead className="bg-muted">
							<tr>
								<th className="p-3">来源</th>
								<th className="p-3">状态</th>
								<th className="p-3">页数</th>
								<th className="p-3">操作</th>
							</tr>
						</thead>
						<tbody>
							{tasks.data.tasks.map((task) => (
								<tr key={task.id} className="border-t align-top">
									<td className="p-3">
										{task.input.kind === "validation"
											? "模型连接验证"
											: task.input.kind === "source"
												? `通知 ${task.input.noticeId} · ${task.input.key.includes("/images/") ? "图片" : "附件"} ${Number(task.input.key.split("/").at(-1)) + 1}`
												: "本地上传文件"}
										<div className="text-xs text-muted-foreground">
											{new Date(task.createdAt).toLocaleString("zh-CN")}
										</div>
									</td>
									<td className="max-w-sm p-3">
										{statusLabels[task.status]}
										{task.error ? (
											<p className="mt-1 break-words text-destructive">{task.error}</p>
										) : null}
									</td>
									<td className="p-3">
										{task.result
											? task.result.pages.length
											: task.progress?.totalPages
												? `${task.progress.extractedPages ?? 0} / ${task.progress.totalPages}`
												: "—"}
									</td>
									<td className="flex flex-wrap gap-2 p-3">
										{task.result ? (
											<Button size="sm" variant="outline" onClick={() => setSelected(task.id)}>
												查看结果
											</Button>
										) : null}
										{task.status !== "completed" &&
										(task.status !== "failed" || task.providerJobId) ? (
											<Button
												size="sm"
												variant="outline"
												disabled={action.isPending}
												onClick={() => action.mutate({ id: task.id, action: "resume" })}
											>
												恢复
											</Button>
										) : null}
										{["completed", "failed"].includes(task.status) ? (
											<Button
												size="sm"
												variant="outline"
												disabled={action.isPending}
												onClick={() => setRerunId(task.id)}
											>
												重新识别
											</Button>
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
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
					{result.isPending ? <p>正在读取结果…</p> : null}
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
					{result.data?.pages.map((page) => (
						<article key={page.index} className="space-y-3 overflow-auto border-t pt-4">
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
			<Dialog
				open={rerunId !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRerunId(null);
					}
				}}
			>
				<DialogContent>
					<DialogTitle>重新识别？</DialogTitle>
					<DialogDescription>这会再次调用 Paddle 并产生用量，现有结果仍会保留。</DialogDescription>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRerunId(null)}>
							取消
						</Button>
						<Button
							disabled={action.isPending}
							onClick={() => {
								if (rerunId) {
									action.mutate({ id: rerunId, action: "rerun" });
									setRerunId(null);
								}
							}}
						>
							确认重新识别
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
