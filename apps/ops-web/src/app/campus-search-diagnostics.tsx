import {
	Disclosure,
	DisclosureSummary,
	StateMessage,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@campus-agent/ui";
import type { CampusSearchDiagnostics } from "../shared/campus-search-diagnostics";
import { formatTimestamp } from "./format";

const labels: Record<string, string> = {
	queued: "排队",
	dispatching: "发出请求",
	received: "服务接收",
	index_loaded: "索引就绪",
	embedded: "向量生成完成",
	retrieved: "召回完成",
	reranked: "重排完成",
	selected: "筛选完成",
	completed: "完成",
	failed: "失败",
	canceled: "已取消",
	running: "进行中",
	incomplete: "记录不完整",
	rerank_below_threshold: "低于重排阈值",
	result_limit: "返回数量限制",
	evidence_char_budget: "正文字符预算",
	same_notice_cap: "同一来源片段数量限制",
	same_section_cap: "同一来源同一章节已保留片段",
	already_returned: "本轮已返回的证据片段",
	embedding: "Embedding",
	retrieval: "召回",
	rerank: "重排",
	selection: "筛选",
	validation: "运行校验",
	index: "读取索引",
};

export function CampusSearchSection({ diagnostics }: { diagnostics: CampusSearchDiagnostics }) {
	return (
		<section aria-label="Campus Search 检索诊断" data-testid="campus-search-diagnostics">
			<h2 className="mb-3 font-semibold text-lg">Campus Search 检索诊断</h2>
			<p className="mb-3 text-sm text-muted-foreground">
				诊断
				{diagnostics.diagnosticState === "COMPLETE"
					? "完整"
					: diagnostics.diagnosticState === "PARTIAL"
						? "部分可用"
						: diagnostics.diagnosticState === "NO_DATA"
							? "无数据"
							: "不可用"}{" "}
				· {diagnostics.calls.length} 次调用。候选与分数用于排障，不代表召回率。
			</p>
			{diagnostics.reason ? <p className="mb-3 text-sm">{diagnostics.reason}</p> : null}
			{diagnostics.calls.map((call) => (
				<Disclosure key={call.invocationId} className="border-y border-border py-3" open>
					<DisclosureSummary className="font-medium">
						{call.searchQuery || "空查询"} · {labels[call.status]}
						{call.currentPhase === call.status
							? ""
							: ` · ${labels[call.currentPhase] ?? call.currentPhase}`}
					</DisclosureSummary>
					<p className="mt-2 text-xs text-muted-foreground">
						{call.workflowStepId} · attempt {call.activityAttempt} · {call.invocationId}
					</p>
					<p className="my-2 text-sm">
						排队 {ms(call.queueMs)} · 请求往返 {ms(call.toolTotalMs)}
						{call.failureCode ? ` · ${call.failureCode}` : ""}
						{call.httpStatus ? ` · 工具 HTTP ${call.httpStatus}` : ""}
					</p>
					<p className="text-xs text-muted-foreground">
						请求往返：发出请求至收到终态；不含排队。执行摘要工具耗时包含工具包装与观察上报；各阶段可嵌套，不能直接相加。
					</p>
					<ol className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
						{Object.entries(call.phaseTimes)
							.sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
							.map(([phase, at]) => (
								<li key={phase}>
									{labels[phase] ?? phase} {formatTimestamp(at)}
								</li>
							))}
					</ol>
					{call.snapshot ? (
						<>
							{call.snapshot.failedStage &&
							(call.status === "failed" || call.status === "canceled") ? (
								<p>失败阶段：{labels[call.snapshot.failedStage]}</p>
							) : null}
							{call.snapshot.failureDetail ? (
								<p className="my-2 whitespace-pre-wrap break-words text-sm">
									失败原因：{call.snapshot.failureDetail}
								</p>
							) : null}
							<p className="my-3 whitespace-pre-wrap text-sm">
								召回查询：{call.snapshot.effectiveQuery}
							</p>
							<p className="my-3 whitespace-pre-wrap text-sm">
								排序目标：{call.snapshot.rerankQuery ?? "未记录"}
							</p>
							<p className="text-sm">
								{call.snapshot.retrievalMode ?? "尚未检索"}
								{call.phaseTimes.retrieved
									? ` · 召回 ${call.snapshot.retrievedCount} · 去重后 ${call.snapshot.deduplicatedCount}`
									: " · 召回尚未完成"}
								{call.phaseTimes.reranked
									? ` · 重排输入 ${call.snapshot.rerankInputCount} · 重排保留 ${call.snapshot.rerankKeptCount}`
									: ""}
								{call.phaseTimes.selected
									? ` · 来源聚合后 ${call.snapshot.sourceGroupedCount} · 同来源排除 ${call.snapshot.sourceGroupedExcludedCount} · 返回模型 ${call.snapshot.returnedCount} · 排除 ${call.snapshot.excludedCount} · 最终引用 ${call.citedCount ?? "未判定"}`
									: ""}
							</p>
							{call.snapshot.embedding ? (
								<p className="my-2 text-xs">
									Embedding：{call.snapshot.embedding.provider} / {call.snapshot.embedding.model} ·{" "}
									{call.snapshot.embedding.dimensions} 维 ·{" "}
									{call.snapshot.embedding.instructionVersion} · 服务{" "}
									{call.snapshot.embedding.serviceOrigin}· 缓存
									{call.snapshot.embedding.cacheOutcome ?? "未记录"} · 合并等待{" "}
									{ms(
										call.snapshot.embedding.cacheWaitMs ??
											(call.snapshot.embedding.cacheOutcome ? 0 : null),
									)}
									· 估算避免的加载耗时
									{ms(
										call.snapshot.embedding.estimatedSavedMs ??
											(call.snapshot.embedding.cacheOutcome ? 0 : null),
									)}
								</p>
							) : (
								<p className="text-xs">Embedding 配置未记录</p>
							)}
							{call.snapshot.retrieval ? (
								<div className="my-2 break-all text-xs">
									<p>Collection：{call.snapshot.retrieval.collection}</p>
									{call.snapshot.retrieval.httpStatus ? (
										<p>Qdrant HTTP 状态：{call.snapshot.retrieval.httpStatus}</p>
									) : null}
									<p>
										Qdrant HTTP 往返 {ms(call.snapshot.retrieval.httpMs)} · Qdrant 服务端{" "}
										{ms(call.snapshot.retrieval.qdrantMs)} · 解码{" "}
										{ms(call.snapshot.retrieval.decodeMs)} · 候选后处理{" "}
										{ms(call.snapshot.retrieval.postprocessMs)}
									</p>
									<p>服务端耗时包含在 HTTP 往返内；两者差值不能直接解释成网络延迟。</p>
								</div>
							) : null}
							{call.snapshot.rerank ? (
								<p className="my-2 text-xs">
									重排：{call.snapshot.rerank.provider} / {call.snapshot.rerank.model} · HTTP 往返{" "}
									{ms(call.snapshot.rerank.httpMs)} · 输入 {call.snapshot.rerank.inputCount}
								</p>
							) : null}
							{call.snapshot.snapshotTruncated ? <p>诊断字段或候选快照已截断。</p> : null}
							<p className="my-2 text-xs">
								{Object.entries(call.snapshot.durations)
									.map(([phase, duration]) => `${labels[phase]} ${ms(duration ?? null)}`)
									.join(" · ")}
							</p>
							{call.snapshot.candidates.length > 0 ? (
								<div className="overflow-x-auto">
									<Table className="w-full text-left text-sm">
										<TableHeader>
											<TableRow>
												<TableHead>候选</TableHead>
												<TableHead>召回 / 重排名次</TableHead>
												<TableHead>融合 / 重排分数</TableHead>
												<TableHead>筛选</TableHead>
												<TableHead>最终引用</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{call.snapshot.candidates.map((candidate) => (
												<TableRow
													key={candidate.resultRef}
													className="border-t border-border align-top"
												>
													<TableCell className="max-w-xl py-3 pr-4">
														<Disclosure>
															<DisclosureSummary>
																{candidate.title} · {candidate.section} ({candidate.sourceKind})
															</DisclosureSummary>
															<p className="my-2 whitespace-pre-wrap">{candidate.text}</p>
															<p>
																来源 ID：{candidate.noticeId ?? candidate.documentId ?? "未记录"}
															</p>
															<p className="break-all text-xs text-muted-foreground">
																{candidate.resultRef}
																{candidate.returned ? "" : " · 正文仅预览"}
															</p>
														</Disclosure>
													</TableCell>
													<TableCell>
														{candidate.retrievalRank} / {candidate.rerankRank ?? "—"}
													</TableCell>
													<TableCell>
														{candidate.fusionScore.toFixed(4)} /{" "}
														{candidate.rerankScore?.toFixed(4) ?? "—"}
													</TableCell>
													<TableCell>
														{candidate.returned
															? `返回 [${candidate.citationIndex}]`
															: candidate.exclusionReason
																? labels[candidate.exclusionReason]
																: "尚未筛选"}
													</TableCell>
													<TableCell>
														{candidate.cited === null
															? "未判定"
															: candidate.cited
																? "已引用"
																: "未引用"}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							) : (
								<StateMessage layout="inline" description="尚无候选记录。" />
							)}
						</>
					) : (
						<StateMessage layout="inline" description="尚无服务端检索快照。" />
					)}
				</Disclosure>
			))}
		</section>
	);
}

function ms(value: number | null): string {
	return value === null ? "未记录" : `${value} ms`;
}
