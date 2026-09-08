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
	embedding: "Embedding",
	retrieval: "召回",
	rerank: "重排",
	selection: "筛选",
};

export function CampusSearchSection({ diagnostics }: { diagnostics: CampusSearchDiagnostics }) {
	return (
		<section aria-label="Campus Search 检索诊断" data-testid="campus-search-diagnostics">
			<h2 className="mb-3 font-semibold text-lg">Campus Search 检索诊断</h2>
			<p className="mb-3 text-sm text-muted-foreground">
				{diagnostics.dataState} · {diagnostics.calls.length}{" "}
				次调用。候选与分数用于排障，不代表召回率。
			</p>
			{diagnostics.reason ? <p className="mb-3 text-sm">{diagnostics.reason}</p> : null}
			{diagnostics.calls.map((call) => (
				<details key={call.invocationId} className="border-y border-border py-3" open>
					<summary className="cursor-pointer font-medium">
						{call.searchQuery || "空查询"} · {labels[call.status]} ·{" "}
						{labels[call.currentPhase] ?? call.currentPhase}
					</summary>
					<p className="mt-2 text-xs text-muted-foreground">
						{call.workflowStepId} · attempt {call.activityAttempt} · {call.invocationId}
					</p>
					<p className="my-2 text-sm">
						排队 {ms(call.queueMs)} · 工具总耗时 {ms(call.toolTotalMs)}
						{call.failureCode ? ` · ${call.failureCode}` : ""}
						{call.httpStatus ? ` · HTTP ${call.httpStatus}` : ""}
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
							<p className="my-3 whitespace-pre-wrap text-sm">
								实际查询：{call.snapshot.effectiveQuery}
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
									? ` · 返回 ${call.snapshot.returnedCount} · 排除 ${call.snapshot.excludedCount}`
									: ""}
							</p>
							<p className="my-2 text-xs">
								{Object.entries(call.snapshot.durations)
									.map(([phase, duration]) => `${labels[phase]} ${ms(duration ?? null)}`)
									.join(" · ")}
							</p>
							{call.snapshot.candidates.length > 0 ? (
								<div className="overflow-x-auto">
									<table className="w-full text-left text-sm">
										<thead>
											<tr>
												<th>候选</th>
												<th>召回 / 重排名次</th>
												<th>融合 / 重排分数</th>
												<th>筛选</th>
												<th>最终引用</th>
											</tr>
										</thead>
										<tbody>
											{call.snapshot.candidates.map((candidate) => (
												<tr key={candidate.resultRef} className="border-t border-border align-top">
													<td className="max-w-xl py-3 pr-4">
														<details>
															<summary className="cursor-pointer">
																{candidate.title} · {candidate.section} ({candidate.sourceKind})
															</summary>
															<p className="my-2 whitespace-pre-wrap">{candidate.text}</p>
															<p className="break-all text-xs text-muted-foreground">
																{candidate.resultRef}
																{candidate.returned ? "" : " · 正文仅预览"}
															</p>
														</details>
													</td>
													<td>
														{candidate.retrievalRank} / {candidate.rerankRank ?? "—"}
													</td>
													<td>
														{candidate.fusionScore.toFixed(4)} /{" "}
														{candidate.rerankScore?.toFixed(4) ?? "—"}
													</td>
													<td>
														{candidate.returned
															? `返回 [${candidate.citationIndex}]`
															: candidate.exclusionReason
																? labels[candidate.exclusionReason]
																: "尚未筛选"}
													</td>
													<td>
														{candidate.cited === null
															? "未判定"
															: candidate.cited
																? "已引用"
																: "未引用"}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<p className="my-3 text-sm text-muted-foreground">尚无候选记录。</p>
							)}
						</>
					) : (
						<p className="mt-3 text-sm text-muted-foreground">尚无服务端检索快照。</p>
					)}
				</details>
			))}
		</section>
	);
}

function ms(value: number | null): string {
	return value === null ? "未记录" : `${value} ms`;
}
