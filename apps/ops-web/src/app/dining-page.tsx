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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type DiningTab = "catalog" | "source" | "releases" | "reviews";

const fieldClass =
	"min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200";

export function DiningPage() {
	const [tab, setTab] = useState<DiningTab>("catalog");
	const queryClient = useQueryClient();
	const overview = useQuery({
		queryKey: ["dining", "overview"],
		queryFn: ({ signal }) => fetchDiningOverview({ signal }),
	});
	const refresh = async () => queryClient.invalidateQueries({ queryKey: ["dining"] });
	const tabs: Array<{ id: DiningTab; label: string }> = [
		{ id: "catalog", label: "目录草稿" },
		{ id: "source", label: "采集记录" },
		{ id: "releases", label: "发布记录" },
		{ id: "reviews", label: "评价管理" },
	];

	return (
		<div className="mx-auto grid w-full max-w-[1440px] gap-6">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-slate-500 text-sm">Dining</p>
					<h1 className="font-semibold text-2xl">食堂内容</h1>
				</div>
				<Button onClick={() => void refresh()} variant="outline">
					<RefreshCw className="size-4" />
					刷新
				</Button>
			</header>
			{overview.data ? (
				<Overview data={overview.data} />
			) : (
				<p className="text-slate-500 text-sm">正在读取食堂状态...</p>
			)}
			<div
				aria-label="食堂管理视图"
				className="flex gap-1 overflow-x-auto border-slate-200 border-b"
				role="tablist"
			>
				{tabs.map((item) => (
					<button
						aria-selected={tab === item.id}
						className={`min-h-11 whitespace-nowrap border-b-2 px-4 font-medium text-sm ${tab === item.id ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-800"}`}
						key={item.id}
						onClick={() => setTab(item.id)}
						role="tab"
						type="button"
					>
						{item.label}
					</button>
				))}
			</div>
			{tab === "catalog" ? <CatalogPanel onChanged={refresh} /> : null}
			{tab === "source" ? <SourcePanel /> : null}
			{tab === "releases" ? <ReleasesPanel onChanged={refresh} /> : null}
			{tab === "reviews" ? <ReviewsPanel onChanged={refresh} /> : null}
		</div>
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
		<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{metrics.map(([label, value]) => (
				<Card className="p-4" key={label}>
					<p className="text-slate-500 text-sm">{label}</p>
					<p className="mt-2 font-semibold text-2xl">{value}</p>
				</Card>
			))}
		</section>
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
	const data = draft.data?.draft;
	return (
		<section className="grid gap-5" role="tabpanel">
			<div className="flex flex-wrap items-center gap-3">
				<Button disabled={rebase.isPending} onClick={() => rebase.mutate()} variant="outline">
					<Database className="size-4" />
					从采集记录重建草稿
				</Button>
				<Badge tone={validation.data?.validation.status === "pass" ? "success" : "danger"}>
					{validation.data?.validation.status === "pass"
						? "校验通过"
						: `${validation.data?.validation.blockers.length ?? 0} 项阻断`}
				</Badge>
			</div>
			<div className="flex flex-col gap-3 border-slate-200 border-y py-4 sm:flex-row">
				<input
					aria-label="发布说明"
					className={`${fieldClass} flex-1`}
					maxLength={500}
					onChange={(event) => setNotes(event.target.value)}
					placeholder="发布说明"
					value={notes}
				/>
				<Button
					disabled={
						!notes.trim() || publish.isPending || validation.data?.validation.status !== "pass"
					}
					onClick={() => publish.mutate()}
				>
					<Send className="size-4" />
					发布
				</Button>
			</div>
			{data ? (
				<>
					<div className="flex flex-wrap gap-4 text-sm">
						<span>{data.halls.length} 个食堂</span>
						<span>{data.windows.length} 个档口位置</span>
						<span>{data.menuOfferings.length} 个菜品</span>
						<span className="text-slate-500">更新于 {formatTimestamp(data.updatedAt)}</span>
					</div>
					<div className="overflow-x-auto border-slate-200 border-y">
						<table className="w-full min-w-[720px] text-left text-sm">
							<thead className="bg-slate-50 text-slate-500">
								<tr>
									<th className="px-3 py-3">档口</th>
									<th className="px-3 py-3">标签</th>
									<th className="px-3 py-3">菜品数</th>
									<th className="px-3 py-3 text-right">操作</th>
								</tr>
							</thead>
							<tbody>
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
										<tr className="border-slate-100 border-t" key={stall.stallProfileId}>
											<td className="px-3 py-3">
												{editing === stall.stallProfileId ? (
													<input
														aria-label="档口名称"
														className={fieldClass}
														onChange={(event) => setName(event.target.value)}
														value={name}
													/>
												) : (
													stall.displayName
												)}
											</td>
											<td className="px-3 py-3 text-slate-500">{stall.tags.join("、") || "无"}</td>
											<td className="px-3 py-3">{count}</td>
											<td className="px-3 py-3 text-right">
												{editing === stall.stallProfileId ? (
													<div className="flex justify-end gap-2">
														<Button
															disabled={!name.trim()}
															onClick={() => rename.mutate(stall.stallProfileId)}
														>
															保存
														</Button>
														<Button onClick={() => setEditing(null)} variant="ghost">
															取消
														</Button>
													</div>
												) : (
													<Button
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
				</>
			) : (
				<p className="text-slate-500">正在读取目录草稿...</p>
			)}
		</section>
	);
}

function SourcePanel() {
	const source = useQuery({
		queryKey: ["dining", "source"],
		queryFn: ({ signal }) => fetchDiningSource({ signal }),
	});
	return (
		<section className="grid gap-6" role="tabpanel">
			<div>
				<h2 className="font-semibold text-lg">同步运行</h2>
				<div className="mt-3 overflow-x-auto">
					<table className="w-full min-w-[680px] text-left text-sm">
						<thead className="text-slate-500">
							<tr>
								<th className="py-2">来源</th>
								<th>状态</th>
								<th>读取</th>
								<th>接受</th>
								<th>阻断</th>
								<th>时间</th>
							</tr>
						</thead>
						<tbody>
							{source.data?.runs.map((run) => (
								<tr className="border-slate-200 border-t" key={run.runId}>
									<td className="py-3">{run.sourceType}</td>
									<td>
										<Badge tone={run.status === "completed" ? "success" : "warning"}>
											{run.status}
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
					{source.data?.observations.map((item) => (
						<div
							className="flex flex-wrap items-center gap-3 border-slate-200 border-t py-3 text-sm"
							key={item.observationId}
						>
							<Badge tone={item.status === "accepted" ? "success" : "danger"}>{item.status}</Badge>
							<span>{item.targetKind}</span>
							<code className="text-slate-500 text-xs">{formatId(item.observationId)}</code>
							<span className="ml-auto text-slate-500">{formatTimestamp(item.observedAt)}</span>
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
	return (
		<section className="grid gap-2" role="tabpanel">
			{releases.data?.releases.map((release) => (
				<div
					className="grid gap-3 border-slate-200 border-t py-4 lg:grid-cols-[1fr_360px]"
					key={release.releaseId}
				>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<History className="size-4" />
							<strong>{release.notes}</strong>
							{release.rollbackOfReleaseId ? <Badge tone="warning">回滚发布</Badge> : null}
						</div>
						<p className="mt-1 text-slate-500 text-sm">
							{formatTimestamp(release.createdAt)} · 草稿 {release.draftRevision} ·{" "}
							{formatId(release.releaseId)}
						</p>
					</div>
					<div className="flex gap-2">
						<input
							aria-label="回滚说明"
							className={`${fieldClass} min-w-0 flex-1`}
							onChange={(event) =>
								setNotes((value) => ({ ...value, [release.releaseId]: event.target.value }))
							}
							placeholder="回滚说明"
							value={notes[release.releaseId] ?? ""}
						/>
						<Button
							disabled={!notes[release.releaseId]?.trim() || rollback.isPending}
							onClick={() =>
								rollback.mutate({ id: release.releaseId, note: notes[release.releaseId] ?? "" })
							}
							variant="outline"
						>
							回滚
						</Button>
					</div>
				</div>
			))}
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
	return (
		<section className="grid gap-3" role="tabpanel">
			{reviews.data?.reviews.map((review) => {
				const targetOffering = offering[review.reviewId] ?? review.offeringId ?? "";
				return (
					<article
						className="grid gap-3 border-slate-200 border-t py-4 lg:grid-cols-[1fr_420px]"
						key={review.reviewId}
					>
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<strong>{review.contributorName ?? "匿名"}</strong>
								{review.rating ? (
									<span className="inline-flex items-center gap-1">
										<Star className="size-4 fill-amber-400 text-amber-500" />
										{review.rating}
									</span>
								) : null}
								<Badge tone={review.visibility === "published" ? "success" : "muted"}>
									{review.visibility}
								</Badge>
								<Badge tone={review.moderationStatus === "safe" ? "success" : "danger"}>
									{review.moderationStatus}
								</Badge>
							</div>
							<p className="mt-2">{review.comment ?? "无文字评价"}</p>
							<p className="mt-1 text-slate-500 text-sm">
								{review.stallName} · {review.dishName} · {formatTimestamp(review.submittedAt)}
							</p>
						</div>
						<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
							<input
								aria-label="目标菜品 ID"
								className={fieldClass}
								onChange={(event) =>
									setOffering((value) => ({ ...value, [review.reviewId]: event.target.value }))
								}
								placeholder="目标菜品 ID"
								value={targetOffering}
							/>
							<div className="flex flex-wrap gap-2">
								<Button
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
									{review.visibility === "published" ? "隐藏" : "恢复"}
								</Button>
								<Button
									disabled={!targetOffering.trim()}
									onClick={() =>
										command.mutate({
											id: review.reviewId,
											value: { kind: "rebind", offeringId: targetOffering, reason: "人工精确绑定" },
										})
									}
									variant="outline"
								>
									重新绑定
								</Button>
								<Button
									onClick={() =>
										command.mutate({ id: review.reviewId, value: { kind: "recheck" } })
									}
									variant="ghost"
								>
									<CheckCircle2 className="size-4" />
									复检
								</Button>
							</div>
						</div>
					</article>
				);
			})}
		</section>
	);
}
