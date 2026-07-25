import { Badge, Button, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Database, History, RefreshCw, Send, Star } from "lucide-react";
import { useState } from "react";
import type { DiningReviewCommand } from "../shared/dining-contract";
import { formatId, formatTimestamp } from "./format";
import {
	applyDiningCatalogCommand,
	applyDiningReviewCommand,
	fetchDiningDraft,
	fetchDiningOverview,
	fetchDiningReleases,
	fetchDiningReviews,
	fetchDiningSource,
	fetchDiningValidation,
	publishDiningCatalog,
	rebaseDiningDraft,
	rollbackDiningRelease,
} from "./ops-api-client";
import { ErrorState, InlineError, PageHeader, PageShell, StaleDataWarning } from "./ops-display";

type DiningTab = "catalog" | "source" | "releases" | "reviews";

export function DiningPage() {
	const [tab, setTab] = useState<DiningTab>("catalog");
	const queryClient = useQueryClient();
	const overview = useQuery({
		queryKey: ["dining", "overview"],
		queryFn: ({ signal }) => fetchDiningOverview({ signal }),
	});
	const refresh = useMutation({
		mutationFn: () => queryClient.invalidateQueries({ queryKey: ["dining"] }),
	});
	const tabs: Array<{ id: DiningTab; label: string }> = [
		{ id: "catalog", label: "目录草稿" },
		{ id: "source", label: "采集记录" },
		{ id: "releases", label: "发布记录" },
		{ id: "reviews", label: "评价管理" },
	];
	if (overview.isPending) {
		return (
			<PageShell description="维护食堂目录、采集记录、发布和评价。" title="食堂内容">
				正在读取食堂状态...
			</PageShell>
		);
	}
	if (overview.isError && !overview.data) {
		return (
			<section>
				<PageHeader description="维护食堂目录、采集记录、发布和评价。" title="食堂内容" />
				<ErrorState
					error={overview.error}
					onRetry={() => void overview.refetch()}
					title="食堂状态读取失败"
				/>
			</section>
		);
	}
	if (!overview.data) {
		return <PageShell title="食堂内容">正在读取食堂状态...</PageShell>;
	}

	return (
		<section className="min-w-0">
			<PageHeader
				actions={
					<Button
						aria-busy={refresh.isPending}
						disabled={refresh.isPending}
						onClick={() => refresh.mutate()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						{refresh.isPending ? "刷新中" : "刷新"}
					</Button>
				}
				description="维护食堂目录、采集记录、发布和评价。"
				title="食堂内容"
			/>
			{overview.isRefetchError ? (
				<StaleDataWarning
					error={overview.error}
					lastSuccessfulAt={overview.dataUpdatedAt}
					onRetry={() => refresh.mutate()}
					title="食堂状态刷新失败"
				/>
			) : null}
			<Overview data={overview.data} />
			<Tabs className="min-w-0" onValueChange={(value) => setTab(value as DiningTab)} value={tab}>
				<TabsList
					aria-label="食堂管理视图"
					className="grid grid-cols-4 gap-0 overflow-visible sm:flex sm:gap-1 sm:overflow-x-auto"
				>
					{tabs.map((item) => (
						<TabsTrigger className="min-w-0 px-1 sm:px-4" key={item.id} value={item.id}>
							{item.label}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="catalog">
					<CatalogPanel onChanged={() => refresh.mutateAsync()} />
				</TabsContent>
				<TabsContent value="source">
					<SourcePanel />
				</TabsContent>
				<TabsContent value="releases">
					<ReleasesPanel onChanged={() => refresh.mutateAsync()} />
				</TabsContent>
				<TabsContent value="reviews">
					<ReviewsPanel onChanged={() => refresh.mutateAsync()} />
				</TabsContent>
			</Tabs>
		</section>
	);
}

function Overview({ data }: { data: Awaited<ReturnType<typeof fetchDiningOverview>> }) {
	const metrics = [
		["草稿版本", String(data.draft.revision)],
		["已发布评价", String(data.reviews.published)],
		["待处理评价", String(data.reviews.blocked)],
		["保留发布", String(data.releases)],
	];
	return (
		<dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 border-border border-y py-4 lg:grid-cols-4">
			{metrics.map(([label, value]) => (
				<div className="min-w-0" key={label}>
					<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
					<dd className="mt-1 font-mono font-semibold text-2xl tabular-nums">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function CatalogPanel({ onChanged }: { onChanged: () => Promise<void> }) {
	const [notes, setNotes] = useState("");
	const [editing, setEditing] = useState<string | null>(null);
	const [name, setName] = useState("");
	const draft = useQuery({
		queryKey: ["dining", "draft"],
		queryFn: ({ signal }) => fetchDiningDraft({ signal }),
	});
	const validation = useQuery({
		queryKey: ["dining", "validation"],
		queryFn: ({ signal }) => fetchDiningValidation({ signal }),
	});
	const rebase = useMutation({ mutationFn: rebaseDiningDraft, onSuccess: onChanged });
	const publish = useMutation({
		mutationFn: () => publishDiningCatalog(notes),
		onSuccess: async () => {
			setNotes("");
			await onChanged();
		},
	});
	const rename = useMutation({
		mutationFn: (stallProfileId: string) =>
			applyDiningCatalogCommand({ kind: "rename_stall", stallProfileId, displayName: name }),
		onSuccess: async () => {
			setEditing(null);
			setName("");
			await onChanged();
		},
	});
	const catalogWritePending = rebase.isPending || publish.isPending || rename.isPending;
	const data = draft.data?.draft;
	if (draft.isPending && !data) {
		return <p className="py-6 text-muted-foreground text-sm">正在读取食堂目录...</p>;
	}
	if (draft.isError && !draft.data) {
		return (
			<ErrorState
				error={draft.error}
				onRetry={() => void draft.refetch()}
				title="食堂目录读取失败"
			/>
		);
	}
	return (
		<section aria-busy={catalogWritePending} className="grid gap-5">
			{draft.isRefetchError ? (
				<StaleDataWarning
					error={draft.error}
					lastSuccessfulAt={draft.dataUpdatedAt}
					onRetry={() => void draft.refetch()}
					title="食堂目录刷新失败"
				/>
			) : null}
			<div className="flex flex-wrap items-center gap-3">
				<Button
					aria-busy={rebase.isPending}
					disabled={catalogWritePending}
					onClick={() => rebase.mutate()}
					variant="outline"
				>
					<Database className="size-4" />
					{rebase.isPending ? "重建中" : "从采集记录重建草稿"}
				</Button>
				{validation.isPending && !validation.data ? (
					<Badge tone="neutral">正在校验</Badge>
				) : validation.data ? (
					<Badge tone={validation.data.validation.status === "pass" ? "success" : "danger"}>
						{validation.data.validation.status === "pass"
							? "校验通过"
							: `${validation.data.validation.blockers.length} 项阻断`}
					</Badge>
				) : null}
				{rebase.isError ? (
					<InlineError error={rebase.error} title="草稿重建失败" />
				) : rebase.isSuccess ? (
					<p className="text-success text-sm" role="status">
						草稿已重建。
					</p>
				) : null}
				{validation.isError && !validation.data ? (
					<InlineError error={validation.error} title="目录校验读取失败" />
				) : null}
				{validation.isRefetchError ? (
					<InlineError error={validation.error} title="目录校验刷新失败" />
				) : null}
			</div>
			<div className="flex flex-col gap-3 border-border border-y py-4 sm:flex-row">
				<Input
					aria-label="发布说明"
					className="min-h-11 flex-1"
					maxLength={500}
					onChange={(event) => setNotes(event.target.value)}
					placeholder="发布说明"
					value={notes}
				/>
				<Button
					aria-busy={publish.isPending}
					disabled={
						!notes.trim() || catalogWritePending || validation.data?.validation.status !== "pass"
					}
					onClick={() => publish.mutate()}
				>
					<Send className="size-4" />
					{publish.isPending ? "发布中" : "发布"}
				</Button>
			</div>
			{publish.isError ? <InlineError error={publish.error} title="目录发布失败" /> : null}
			{publish.isSuccess ? (
				<p className="text-success text-sm" role="status">
					目录发布已提交。
				</p>
			) : null}
			{data ? (
				<>
					<div className="flex flex-wrap gap-4 text-sm">
						<span>{data.halls.length} 个食堂</span>
						<span>{data.windows.length} 个档口位置</span>
						<span>{data.menuOfferings.length} 个菜品</span>
						<span className="text-muted-foreground">更新于 {formatTimestamp(data.updatedAt)}</span>
					</div>
					<div className="overflow-x-auto border-border border-y">
						<table className="w-full min-w-[720px] text-left text-sm">
							<caption className="sr-only">食堂目录档口</caption>
							<thead className="bg-secondary text-muted-foreground">
								<tr>
									<th className="px-3 py-3" scope="col">
										档口
									</th>
									<th className="px-3 py-3" scope="col">
										标签
									</th>
									<th className="px-3 py-3" scope="col">
										菜品数
									</th>
									<th className="px-3 py-3 text-right" scope="col">
										操作
									</th>
								</tr>
							</thead>
							<tbody>
								{data.stallProfiles.length === 0 ? (
									<tr>
										<td className="px-3 py-6 text-center text-muted-foreground" colSpan={4}>
											暂无档口目录。
										</td>
									</tr>
								) : null}
								{data.stallProfiles.map((stall) => {
									const assignment = data.assignments.find(
										(item) => item.stallProfileId === stall.stallProfileId,
									);
									const count = assignment
										? data.menuOfferings.filter(
												(item) => item.assignmentId === assignment.assignmentId,
											).length
										: 0;
									return (
										<tr className="border-border border-t" key={stall.stallProfileId}>
											<td className="px-3 py-3">
												{editing === stall.stallProfileId ? (
													<Input
														aria-label="档口名称"
														className="min-h-11"
														onChange={(event) => setName(event.target.value)}
														value={name}
													/>
												) : (
													stall.displayName
												)}
											</td>
											<td className="px-3 py-3 text-muted-foreground">
												{stall.tags.join("、") || "无"}
											</td>
											<td className="px-3 py-3">{count}</td>
											<td className="px-3 py-3 text-right">
												{editing === stall.stallProfileId ? (
													<div className="flex justify-end gap-2">
														<Button
															aria-busy={rename.isPending}
															disabled={!name.trim() || catalogWritePending}
															onClick={() => rename.mutate(stall.stallProfileId)}
														>
															{rename.isPending ? "保存中" : "保存"}
														</Button>
														<Button onClick={() => setEditing(null)} variant="ghost">
															取消
														</Button>
													</div>
												) : (
													<Button
														disabled={catalogWritePending}
														onClick={() => {
															setEditing(stall.stallProfileId);
															setName(stall.displayName);
														}}
														variant="ghost"
													>
														编辑
													</Button>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					{rename.isError ? <InlineError error={rename.error} title="档口改名失败" /> : null}
					{rename.isSuccess ? (
						<p className="text-success text-sm" role="status">
							档口名称已更新。
						</p>
					) : null}
				</>
			) : (
				<p className="text-muted-foreground">正在读取目录草稿...</p>
			)}
		</section>
	);
}

function SourcePanel() {
	const source = useQuery({
		queryKey: ["dining", "source"],
		queryFn: ({ signal }) => fetchDiningSource({ signal }),
	});
	if (source.isPending && !source.data) {
		return <p className="py-6 text-muted-foreground text-sm">正在读取采集记录...</p>;
	}
	if (source.isError && !source.data) {
		return (
			<ErrorState
				error={source.error}
				onRetry={() => void source.refetch()}
				title="采集记录读取失败"
			/>
		);
	}
	return (
		<section className="grid gap-6">
			{source.isRefetchError ? (
				<StaleDataWarning
					error={source.error}
					lastSuccessfulAt={source.dataUpdatedAt}
					onRetry={() => void source.refetch()}
					title="采集记录刷新失败"
				/>
			) : null}
			<div>
				<h2 className="font-semibold text-lg">同步运行</h2>
				<div className="mt-3 overflow-x-auto">
					<table className="w-full min-w-[680px] text-left text-sm">
						<caption className="sr-only">食堂同步运行</caption>
						<thead className="text-muted-foreground">
							<tr>
								<th className="py-2" scope="col">
									来源
								</th>
								<th scope="col">状态</th>
								<th scope="col">读取</th>
								<th scope="col">接受</th>
								<th scope="col">阻断</th>
								<th scope="col">时间</th>
							</tr>
						</thead>
						<tbody>
							{source.data?.runs.length === 0 ? (
								<tr>
									<td className="py-6 text-center text-muted-foreground" colSpan={6}>
										暂无同步运行。
									</td>
								</tr>
							) : null}
							{source.data?.runs.map((run) => (
								<tr className="border-border border-t" key={run.runId}>
									<td className="py-3">{diningValueLabel(run.sourceType)}</td>
									<td>
										<Badge tone={diningStatusTone(run.status)}>
											{diningValueLabel(run.status)}
										</Badge>
									</td>
									<td>{run.totalCount}</td>
									<td>{run.acceptedCount}</td>
									<td>{run.blockedCount}</td>
									<td>{formatTimestamp(run.startedAt)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
			<div>
				<h2 className="font-semibold text-lg">最新采集记录</h2>
				<div className="mt-3 grid gap-2">
					{source.data?.observations.length === 0 ? (
						<p className="border-border border-t py-6 text-muted-foreground text-sm">
							暂无采集记录。
						</p>
					) : null}
					{source.data?.observations.map((item) => (
						<div
							className="flex flex-wrap items-center gap-3 border-border border-t py-3 text-sm"
							key={item.observationId}
						>
							<Badge tone={diningStatusTone(item.status)}>{diningValueLabel(item.status)}</Badge>
							<span>{diningValueLabel(item.targetKind)}</span>
							<code className="text-muted-foreground text-xs">{formatId(item.observationId)}</code>
							<span className="ml-auto text-muted-foreground">
								{formatTimestamp(item.observedAt)}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

function ReleasesPanel({ onChanged }: { onChanged: () => Promise<void> }) {
	const [notes, setNotes] = useState<Record<string, string>>({});
	const releases = useQuery({
		queryKey: ["dining", "releases"],
		queryFn: ({ signal }) => fetchDiningReleases({ signal }),
	});
	const rollback = useMutation({
		mutationFn: ({ id, note }: { id: string; note: string }) => rollbackDiningRelease(id, note),
		onSuccess: onChanged,
	});
	if (releases.isPending && !releases.data) {
		return <p className="py-6 text-muted-foreground text-sm">正在读取发布记录...</p>;
	}
	if (releases.isError && !releases.data) {
		return (
			<ErrorState
				error={releases.error}
				onRetry={() => void releases.refetch()}
				title="发布记录读取失败"
			/>
		);
	}
	return (
		<section aria-busy={rollback.isPending} className="grid gap-2">
			{releases.isRefetchError ? (
				<StaleDataWarning
					error={releases.error}
					lastSuccessfulAt={releases.dataUpdatedAt}
					onRetry={() => void releases.refetch()}
					title="发布记录刷新失败"
				/>
			) : null}
			{releases.data?.releases.length === 0 ? (
				<p className="border-border border-y py-6 text-muted-foreground text-sm">暂无发布记录。</p>
			) : null}
			{releases.data?.releases.map((release) => (
				<div
					className="grid gap-3 border-border border-t py-4 lg:grid-cols-[1fr_360px]"
					key={release.releaseId}
				>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<History className="size-4" />
							<strong>{release.notes}</strong>
							{release.rollbackOfReleaseId ? (
								<span className="text-warning text-sm">回滚发布</span>
							) : null}
						</div>
						<p className="mt-1 text-muted-foreground text-sm">
							{formatTimestamp(release.createdAt)} · 草稿 {release.draftRevision} ·{" "}
							{formatId(release.releaseId)}
						</p>
					</div>
					<div className="flex gap-2">
						<Input
							aria-label="回滚说明"
							className="min-h-11 min-w-0 flex-1"
							onChange={(event) =>
								setNotes((value) => ({ ...value, [release.releaseId]: event.target.value }))
							}
							placeholder="回滚说明"
							value={notes[release.releaseId] ?? ""}
						/>
						<Button
							aria-busy={rollback.isPending && rollback.variables?.id === release.releaseId}
							disabled={!notes[release.releaseId]?.trim() || rollback.isPending}
							onClick={() =>
								rollback.mutate({ id: release.releaseId, note: notes[release.releaseId] ?? "" })
							}
							variant="outline"
						>
							{rollback.isPending && rollback.variables?.id === release.releaseId
								? "回滚中"
								: "回滚"}
						</Button>
					</div>
				</div>
			))}
			{rollback.isError ? (
				<InlineError
					error={rollback.error}
					title={`发布 ${formatId(rollback.variables?.id ?? "未知记录")} 回滚失败`}
				/>
			) : null}
			{rollback.isSuccess ? (
				<p className="text-success text-sm" role="status">
					发布 {formatId(rollback.variables?.id ?? "未知记录")} 的回滚已提交。
				</p>
			) : null}
		</section>
	);
}

function ReviewsPanel({ onChanged }: { onChanged: () => Promise<void> }) {
	const [offering, setOffering] = useState<Record<string, string>>({});
	const reviews = useQuery({
		queryKey: ["dining", "reviews"],
		queryFn: ({ signal }) => fetchDiningReviews({ signal }),
	});
	const command = useMutation({
		mutationFn: ({ id, value }: { id: string; value: DiningReviewCommand }) =>
			applyDiningReviewCommand(id, value),
		onSuccess: onChanged,
	});
	if (reviews.isPending && !reviews.data) {
		return <p className="py-6 text-muted-foreground text-sm">正在读取评价记录...</p>;
	}
	if (reviews.isError && !reviews.data) {
		return (
			<ErrorState
				error={reviews.error}
				onRetry={() => void reviews.refetch()}
				title="评价记录读取失败"
			/>
		);
	}
	return (
		<section aria-busy={command.isPending} className="grid gap-3">
			{reviews.isRefetchError ? (
				<StaleDataWarning
					error={reviews.error}
					lastSuccessfulAt={reviews.dataUpdatedAt}
					onRetry={() => void reviews.refetch()}
					title="评价记录刷新失败"
				/>
			) : null}
			{reviews.data?.reviews.length === 0 ? (
				<p className="border-border border-y py-6 text-muted-foreground text-sm">暂无评价记录。</p>
			) : null}
			{reviews.data?.reviews.map((review) => {
				const targetOffering = offering[review.reviewId] ?? review.offeringId ?? "";
				return (
					<article
						className="grid gap-3 border-border border-t py-4 lg:grid-cols-[1fr_420px]"
						key={review.reviewId}
					>
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<strong>{review.contributorName ?? "匿名"}</strong>
								{review.rating ? (
									<span className="inline-flex items-center gap-1">
										<Star className="size-4 fill-[var(--ops-rating)] text-[var(--ops-rating)]" />
										{review.rating}
									</span>
								) : null}
								<span className="text-muted-foreground text-sm">
									{review.visibility === "published" ? "已发布" : "未发布"}
								</span>
								<Badge tone={review.moderationStatus === "safe" ? "success" : "danger"}>
									{diningValueLabel(review.moderationStatus)}
								</Badge>
							</div>
							<p className="mt-2">{review.comment ?? "无文字评价"}</p>
							<p className="mt-1 text-muted-foreground text-sm">
								{review.stallName} · {review.dishName} · {formatTimestamp(review.submittedAt)}
							</p>
						</div>
						<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
							<Input
								aria-label="目标菜品 ID"
								className="min-h-11"
								onChange={(event) =>
									setOffering((value) => ({ ...value, [review.reviewId]: event.target.value }))
								}
								placeholder="目标菜品 ID"
								value={targetOffering}
							/>
							<div className="flex flex-wrap gap-2">
								<Button
									aria-busy={command.isPending && command.variables?.id === review.reviewId}
									disabled={command.isPending}
									onClick={() =>
										command.mutate({
											id: review.reviewId,
											value: {
												kind: review.visibility === "published" ? "hide" : "restore",
												reason: "人工审核",
											},
										})
									}
									variant="outline"
								>
									{command.isPending && command.variables?.id === review.reviewId
										? "提交中"
										: review.visibility === "published"
											? "隐藏"
											: "恢复"}
								</Button>
								<Button
									aria-busy={command.isPending && command.variables?.id === review.reviewId}
									disabled={!targetOffering.trim() || command.isPending}
									onClick={() =>
										command.mutate({
											id: review.reviewId,
											value: { kind: "rebind", offeringId: targetOffering, reason: "人工精确绑定" },
										})
									}
									variant="outline"
								>
									{command.isPending && command.variables?.id === review.reviewId
										? "提交中"
										: "重新绑定"}
								</Button>
								<Button
									aria-busy={command.isPending && command.variables?.id === review.reviewId}
									disabled={command.isPending}
									onClick={() =>
										command.mutate({ id: review.reviewId, value: { kind: "recheck" } })
									}
									variant="ghost"
								>
									<CheckCircle2 className="size-4" />
									{command.isPending && command.variables?.id === review.reviewId
										? "提交中"
										: "复检"}
								</Button>
							</div>
						</div>
					</article>
				);
			})}
			{command.isError ? (
				<InlineError
					error={command.error}
					title={`评价 ${formatId(command.variables?.id ?? "未知记录")} 操作失败`}
				/>
			) : null}
			{command.isSuccess ? (
				<p className="text-success text-sm" role="status">
					评价 {formatId(command.variables?.id ?? "未知记录")} 的操作已提交。
				</p>
			) : null}
		</section>
	);
}

const DINING_VALUE_LABELS: Record<string, string> = {
	accepted: "已接受",
	blocked: "已阻断",
	campus: "校区",
	completed: "已完成",
	failed: "失败",
	feishu_catalog: "飞书目录",
	feishu_review: "飞书评价",
	hall: "食堂",
	menu_item: "菜品",
	menu_offering: "供应菜品",
	observed: "待处理",
	offering: "供应菜品",
	running: "运行中",
	safe: "审核通过",
	stall: "档口",
	window: "窗口",
};

function diningValueLabel(value: string) {
	return DINING_VALUE_LABELS[value] ?? value;
}

function diningStatusTone(status: string): "danger" | "success" | "warning" {
	if (status === "completed" || status === "accepted" || status === "safe") {
		return "success";
	}
	return status === "failed" || status === "blocked" ? "danger" : "warning";
}
