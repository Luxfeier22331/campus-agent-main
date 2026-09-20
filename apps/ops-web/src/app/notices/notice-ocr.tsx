import { Button, NativeSelect, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NoticeOcrSchema } from "../../shared/ocr-contract";
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
	const [batch, setBatch] = useState<Record<string, string>>({});
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
	return (
		<section aria-labelledby="notice-ocr-heading" className="grid min-w-0 gap-3">
			<h3 id="notice-ocr-heading" className="font-medium text-sm">
				识别结果
			</h3>
			{query.data && query.data.resources.length > 0 ? (
				<p className="text-xs text-muted-foreground">可识别资源 {query.data.resources.length} 项</p>
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
				<p className="text-sm text-muted-foreground">没有可识别的图片或 PDF。</p>
			) : null}
			<ul className="min-w-0 divide-y">
				{query.data?.resources.map((resource) => {
					const available = resource.batches.filter((item) => item.hasResult);
					const selectedId =
						batch[resource.sourceKey] ?? resource.selectedResultId ?? available[0]?.id;
					const selectedBatch = available.find((item) => item.id === selectedId);
					const latest = resource.batches[0];
					return (
						<li key={resource.sourceKey} className="flex min-w-0 flex-wrap items-center gap-3 py-3">
							<div className="min-w-0 flex-1 basis-40">
								<p className="break-words text-sm">{resource.label}</p>
								<p className="text-xs text-muted-foreground">
									{selectedBatch
										? `${selectedBatch.pageCount} 页`
										: latest
											? labels[latest.status]
											: "未识别"}
								</p>
							</div>
							{available.length > 1 ? (
								<NativeSelect
									aria-label={`${resource.label}识别批次`}
									className="w-full sm:w-auto"
									value={selectedId ?? ""}
									onChange={(event) =>
										setBatch((previous) => ({
											...previous,
											[resource.sourceKey]: event.target.value,
										}))
									}
								>
									{available.map((item) => (
										<option key={item.id} value={item.id}>
											{item.createdAt}
										</option>
									))}
								</NativeSelect>
							) : null}
							{selectedBatch ? (
								<Button size="sm" variant="outline" onClick={() => setSelected(selectedBatch.id)}>
									查看结果
								</Button>
							) : null}
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
