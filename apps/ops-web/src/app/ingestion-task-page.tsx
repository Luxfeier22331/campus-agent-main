import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { formatTimestamp } from "./format";
import { fetchIngestionTask, retryIngestionTask } from "./ops-api-client";
import { ErrorState, InlineError, KeyValue, PageHeader, PageShell } from "./ops-display";

export function IngestionTaskPage({ taskId }: { taskId: string }) {
	const queryClient = useQueryClient();
	const task = useQuery({
		queryFn: ({ signal }) => fetchIngestionTask(taskId, { signal }),
		queryKey: ["ops", "ingestion", "task", taskId],
		refetchInterval: (query) => (query.state.data?.status === "running" ? 5_000 : false),
	});
	const retry = useMutation({
		mutationFn: () => retryIngestionTask(taskId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["ops", "ingestion", "tasks"] });
		},
	});
	if (task.isPending) {
		return <PageShell title="采集任务">正在读取任务...</PageShell>;
	}
	if (task.isError || !task.data) {
		return (
			<section>
				<PageHeader description={taskId} title="采集任务" />
				<Card>
					<CardContent className="p-4">
						<ErrorState
							error={task.error}
							onRetry={() => task.refetch()}
							title="采集任务读取失败"
						/>
					</CardContent>
				</Card>
			</section>
		);
	}
	const data = task.data;
	return (
		<section>
			<PageHeader
				actions={
					<Button asChild variant="outline">
						<Link to="/ingestion">
							<ArrowLeft className="size-4" />
							返回
						</Link>
					</Button>
				}
				description={data.task_id}
				title="采集任务"
			/>
			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>执行状态</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="mb-3">
							<Badge
								tone={
									data.status === "completed"
										? "success"
										: data.status === "failed"
											? "danger"
											: data.status === "running"
												? "warning"
												: "neutral"
								}
							>
								{taskStatusLabel(data.status)}
							</Badge>
						</div>
						<KeyValue label="阶段" value={data.registry_task_id} />
						<KeyValue label="运行标识" value={data.run_id} />
						<KeyValue label="提交人" value={data.created_by} />
						<KeyValue label="开始时间" value={formatTimestamp(data.created_at)} />
						<KeyValue label="更新时间" value={formatTimestamp(data.updated_at)} />
						<KeyValue label="错误代码" value={data.error_code ?? data.last_error_code ?? "无"} />
						<KeyValue
							label="错误信息"
							value={data.error_message ?? data.last_error_message ?? "无"}
						/>
						{(data.status === "failed" || data.status === "canceled") &&
						!data.pipeline_workflow_id ? (
							<div className="mt-4">
								<Button disabled={retry.isPending} onClick={() => retry.mutate()}>
									<RotateCcw className="size-4" />
									重试
								</Button>
							</div>
						) : null}
						{retry.isError ? (
							<div className="mt-3">
								<InlineError error={retry.error} title="任务重试失败" />
							</div>
						) : null}
						{retry.isSuccess ? (
							<p className="mt-3 break-all text-success text-sm" role="status">
								重试任务已提交：
								<Link
									className="font-mono underline underline-offset-4"
									params={{ taskId: retry.data.task_id }}
									to="/ingestion/tasks/$taskId"
								>
									{retry.data.task_id}
								</Link>
							</p>
						) : null}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>任务合同</CardTitle>
					</CardHeader>
					<CardContent>
						<KeyValue label="执行器" value={data.executor_kind} />
						<KeyValue label="输入合同" value={data.input_contract ?? "暂无"} />
						<KeyValue
							label="输出合同"
							value={data.output_contract ?? data.result_contract ?? "暂无"}
						/>
						<KeyValue
							label="来源"
							value={
								[data.source_channel, data.source_family].filter(Boolean).join(" / ") || "暂无"
							}
						/>
						<KeyValue
							label="目标"
							value={[data.corpus, data.collection].filter(Boolean).join(" / ") || "暂无"}
						/>
						<KeyValue label="父工作流" value={data.pipeline_workflow_id ?? "无"} />
						<KeyValue label="重试来源" value={data.retry_of_task_id ?? "无"} />
						<KeyValue
							label="结果摘要"
							value={
								data.summary ? (
									<pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs">
										{JSON.stringify(data.summary, null, 2)}
									</pre>
								) : (
									"暂无"
								)
							}
						/>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function taskStatusLabel(status: "canceled" | "completed" | "failed" | "running") {
	switch (status) {
		case "completed":
			return "已完成";
		case "failed":
			return "失败";
		case "running":
			return "运行中";
		case "canceled":
			return "已取消";
		default:
			return "未知";
	}
}
