import { Button, Disclosure, DisclosureSummary } from "@campus-agent/ui";
import type { OcrResource } from "../shared/ocr-contract";
import { formatTimestamp } from "./format";
export const ocrStatusLabels = {
	pending: "等待识别",
	submitting: "正在上传",
	submitted: "正在识别",
	completed: "已完成",
	failed: "识别失败",
};
export function OcrHistory({
	resource,
	onResult,
}: {
	resource: OcrResource;
	onResult: (id: string) => void;
}) {
	return (
		<Disclosure className="mt-2 text-xs">
			<DisclosureSummary>历史尝试（{resource.batches.length}）</DisclosureSummary>
			<ul className="grid gap-3 py-2">
				{resource.batches.map((batch) => (
					<li key={batch.id}>
						<p>
							{formatTimestamp(batch.createdAt)} · {ocrStatusLabels[batch.status]}
							{batch.id === resource.selectedResultId ? " · 当前可用结果" : ""}
						</p>
						{batch.error ? (
							<p className="whitespace-pre-wrap break-words text-danger">{batch.error}</p>
						) : null}
						{batch.hasResult ? (
							<Button size="sm" variant="ghost" onClick={() => onResult(batch.id)}>
								查看此结果
							</Button>
						) : null}
					</li>
				))}
			</ul>
		</Disclosure>
	);
}
