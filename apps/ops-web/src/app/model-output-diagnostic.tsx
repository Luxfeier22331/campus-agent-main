import { Disclosure, DisclosureSummary } from "@campus-agent/ui";
import type { ModelOutputDiagnostic } from "../shared/model-output-diagnostic.ts";

export function ModelOutputDiagnosticPanel({
	diagnostic,
}: {
	diagnostic?: ModelOutputDiagnostic | null | undefined;
}) {
	return (
		<Disclosure className="rounded border border-border p-3 text-sm">
			<DisclosureSummary className="font-medium">模型输出诊断</DisclosureSummary>
			{diagnostic ? (
				<div className="mt-2 space-y-2">
					<p>
						校验阶段：{diagnostic.validation_stage === "json_parse" ? "JSON 解析" : "结构校验"} ·
						Schema：{diagnostic.output_schema}
					</p>
					<p>
						结束原因：{diagnostic.finish_reason ?? "未记录"} · 原文 {diagnostic.original_utf8_bytes}{" "}
						字节{diagnostic.truncated ? " · 已截断，仅显示前 64 KiB 以内文本" : " · 完整"}
					</p>
					<p>{diagnostic.validation_message}</p>
					<pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3">
						{diagnostic.text === "" ? "模型返回空文本" : diagnostic.text}
					</pre>
				</div>
			) : (
				<p className="mt-2 text-muted-foreground">未记录模型输出，不能据此判断模型返回了空文本。</p>
			)}
		</Disclosure>
	);
}
