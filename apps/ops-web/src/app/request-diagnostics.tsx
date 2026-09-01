import { cn } from "@campus-agent/ui";
import type { OpsRequestDetailResponse } from "../shared/ops-contract";
import { formatDuration, formatTimestamp } from "./format";
import { KeyValue } from "./ops-display";
import { formatOpsDomainValue } from "./ops-domain-labels";

export function RequestDiagnostics({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<>
			<FailureSection detail={detail} />
			<RunClosureSection detail={detail} />
			<ExecutionSection detail={detail} />
		</>
	);
}

function RunClosureSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const { failCloseReason, terminalReason } = detail.execution;
	if (!(failCloseReason || terminalReason)) {
		return null;
	}
	return (
		<section aria-labelledby="request-run-closure-title" data-testid="request-run-closure">
			<h2 className="mb-3 font-semibold text-foreground text-lg" id="request-run-closure-title">
				运行终态
			</h2>
			<div className="grid border-border border-y text-sm sm:grid-cols-2">
				<KeyValue label="运行终态" value={formatOpsDomainValue(terminalReason)} />
				<KeyValue label="协调收口原因" value={formatOpsDomainValue(failCloseReason)} />
			</div>
		</section>
	);
}

function FailureSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const failure = detail.execution.failure;
	if (!hasFailure(failure)) {
		return null;
	}
	return (
		<section aria-labelledby="request-failure-title" data-testid="request-failure">
			<h2 className="mb-3 font-semibold text-foreground text-lg" id="request-failure-title">
				失败摘要
			</h2>
			<div className="grid border-danger/30 border-y text-sm sm:grid-cols-2 lg:grid-cols-3">
				<KeyValue
					label="失败代码"
					value={failure.code ? formatOpsDomainValue(failure.code) : "未记录"}
				/>
				<KeyValue label="操作" value={failure.operation ?? "未记录"} />
				<KeyValue label="详情" value={failure.detail ?? "未记录"} />
				<KeyValue label="HTTP 状态" value={failure.httpStatus?.toString() ?? "未记录"} />
				<KeyValue label="工具调用 ID" value={failure.invocationId ?? "未记录"} />
			</div>
		</section>
	);
}

function ExecutionSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const { model, releases, stages } = detail.execution;
	return (
		<section aria-labelledby="request-execution-title" data-testid="request-execution">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-foreground text-lg" id="request-execution-title">
					执行摘要
				</h2>
				<span className="text-muted-foreground text-sm">{stages.length} 个阶段</span>
			</div>
			<div className="grid border-border border-y text-sm sm:grid-cols-2 lg:grid-cols-4">
				<KeyValue label="模型 Provider" value={model.provider ?? "未记录"} />
				<KeyValue label="模型" value={model.name ?? "未记录"} />
				<KeyValue label="模型请求数" value={model.requestCount.toString()} />
				<KeyValue label="输入 Token" value={formatToken(model.tokens.input)} />
				<KeyValue label="缓存输入 Token" value={formatToken(model.tokens.cachedInput)} />
				<KeyValue label="输出 Token" value={formatToken(model.tokens.output)} />
				<KeyValue label="Token 合计" value={formatToken(model.tokens.total)} />
				<KeyValue label="Agent Runtime release" value={releases.agentRuntime ?? "未记录"} />
				<KeyValue label="Execution Control release" value={releases.executionControl ?? "未记录"} />
			</div>
			{stages.length === 0 ? (
				<p className="mt-4 border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
					尚未记录执行阶段。
				</p>
			) : (
				<ol className="mt-4 divide-y divide-border border-border border-y">
					{stages.map((stage) => (
						<li
							className="grid gap-2 py-4"
							key={[
								stage.kind,
								stage.status,
								stage.startedAt,
								stage.completedAt,
								stage.failureKind,
							].join(":")}
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<p className="font-semibold text-foreground">
										{formatOpsDomainValue(stage.kind)}
									</p>
									<p className="mt-1 text-muted-foreground text-sm">
										{formatTimestamp(stage.startedAt)} 至 {formatTimestamp(stage.completedAt)}
										{stage.durationMs === null ? "" : ` · ${formatDuration(stage.durationMs)}`}
									</p>
								</div>
								<span
									className={cn(
										"font-medium text-sm",
										stage.status === "failed" ? "text-danger" : "text-foreground",
									)}
								>
									{formatOpsDomainValue(stage.status)}
								</span>
							</div>
							{stage.failureKind ? (
								<p className="text-danger text-sm">
									失败类型：{formatOpsDomainValue(stage.failureKind)}
								</p>
							) : null}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function hasFailure(failure: OpsRequestDetailResponse["execution"]["failure"]) {
	return Boolean(
		failure.code ||
			failure.operation ||
			failure.detail ||
			failure.httpStatus ||
			failure.invocationId,
	);
}

function formatToken(value: number | null) {
	return value === null ? "未记录" : new Intl.NumberFormat("zh-CN").format(value);
}
