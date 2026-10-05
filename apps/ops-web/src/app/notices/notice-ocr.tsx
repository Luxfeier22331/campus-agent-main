import { Button, StateMessage } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type NoticeOcr, NoticeOcrSchema } from "../../shared/ocr-contract";
import { OcrHistory } from "../ocr-history";
import { OcrResultDialog } from "../ocr-result-dialog";
import { fetchJson } from "../ops-api/core";
import { ErrorState } from "../ops-display";

const labels = {
	pending: "等待识别",
	submitting: "正在上传",
	submitted: "正在识别",
	completed: "已完成",
	failed: "识别失败",
} as const;

export function NoticeOcrSection({
	noticeId,
	active = true,
}: {
	noticeId: number;
	active?: boolean;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const query = useQuery({
		enabled: active,
		queryKey: ["ocr", "notice", noticeId],
		queryFn: async ({ signal }) =>
			NoticeOcrSchema.parse(await fetchJson(`/api/ops/ocr/notices/${noticeId}`, { signal })),
		refetchInterval: (current) =>
			active &&
			current.state.data?.resources.some((resource) =>
				resource.batches.some((item) =>
					["pending", "submitting", "submitted"].includes(item.status),
				),
			)
				? 5000
				: false,
	});
	const client = useQueryClient();
	const identify = useMutation({
		mutationFn: async (resource: NoticeOcr["resources"][number]) => {
			const latest = resource.batches[0];
			const result = (await fetchJson(
				latest
					? `/api/ops/ocr/tasks/${latest.id}/${["failed", "completed"].includes(latest.status) ? "rerun" : "resume"}`
					: "/api/ops/ocr/tasks",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					...(latest
						? {}
						: {
								body: JSON.stringify({
									noticeId: String(noticeId),
									imageOrdinal: resource.displayOrdinal,
								}),
							}),
				},
			)) as { launchError?: string | null };
			return result;
		},
		onSuccess: async () => {
			await Promise.all([
				client.invalidateQueries({ queryKey: ["ocr", "notice", noticeId], exact: true }),
				client.invalidateQueries({ queryKey: ["ocr", "tasks"], exact: true }),
			]);
		},
	});

	return (
		<section aria-labelledby="notice-ocr-heading" className="grid min-w-0 gap-3">
			<h3 id="notice-ocr-heading" className="font-medium text-sm">
				识别结果
			</h3>
			{query.data && query.data.resources.length > 0 ? (
				<p className="text-xs text-muted-foreground">正文图片 {query.data.resources.length} 张</p>
			) : null}
			{query.isPending ? (
				<StateMessage layout="inline" role="status" description={<>正在读取识别结果…</>} />
			) : null}
			{query.isError ? (
				<ErrorState
					error={query.error}
					onRetry={() => void query.refetch()}
					title="识别结果读取失败"
				/>
			) : null}
			{query.data?.resources.length === 0 ? (
				<StateMessage description={<>没有可识别的正文图片。</>} />
			) : null}
			{identify.isError ? <ErrorState error={identify.error} title="识别任务提交失败" /> : null}
			{identify.data?.launchError ? (
				<p role="alert" className="text-sm text-destructive">
					任务已保存，启动失败：{identify.data.launchError}
				</p>
			) : null}
			<ul className="min-w-0 divide-y">
				{query.data?.resources.map((resource) => {
					const selectedBatch = resource.batches.find(
						(item) => item.id === resource.selectedResultId,
					);
					const latest = resource.batches[0];
					return (
						<li key={resource.sourceKey} className="flex min-w-0 flex-wrap items-center gap-3 py-3">
							<a
								href={`/api/ops/notices/${noticeId}/images/${resource.displayOrdinal}`}
								target="_blank"
								rel="noreferrer"
							>
								<img
									className="h-20 w-24 rounded object-contain"
									loading="lazy"
									src={`/api/ops/notices/${noticeId}/images/${resource.displayOrdinal}`}
									alt={`${resource.label}原图`}
								/>
							</a>
							<div className="min-w-0 flex-1 basis-40">
								<p className="break-words text-sm">{resource.label}</p>
								<p className="text-xs text-muted-foreground">
									最新尝试：<span>{latest ? labels[latest.status] : "未识别"}</span>
								</p>
								<p className="text-xs text-muted-foreground">
									当前结果：
									{selectedBatch ? `可用 · ${selectedBatch.pageCount} 页` : "暂无可用文本"}
								</p>
							</div>
							<Button
								size="sm"
								variant="outline"
								disabled={identify.isPending}
								onClick={() => identify.mutate(resource)}
							>
								{latest
									? ["completed", "failed"].includes(latest.status)
										? "重新识别"
										: "恢复识别"
									: "识别图片"}
							</Button>
							{latest?.error ? (
								<p className="w-full break-words text-sm text-destructive">{latest.error}</p>
							) : null}

							{selectedBatch ? (
								<Button size="sm" variant="ghost" onClick={() => setSelected(selectedBatch.id)}>
									查看结果
								</Button>
							) : null}
							<div className="w-full">
								<OcrHistory resource={resource} onResult={setSelected} />
							</div>
						</li>
					);
				})}
			</ul>
			<OcrResultDialog
				url={selected ? `/api/ops/ocr/tasks/${selected}/result` : null}
				onClose={() => setSelected(null)}
			/>
		</section>
	);
}
