import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, GitBranch, Rocket, ShieldCheck, XCircle } from "lucide-react";
import type React from "react";
import { useState } from "react";

import {
	approveDiningReleaseCandidate,
	createDiningReleaseCandidate,
	listDiningReleaseCandidates,
	listDiningReleases,
	publishDiningReleaseCandidate,
	validateDiningReleaseCandidate,
} from "../../features/dining/api";
import type { DiningReleaseCandidate } from "../../features/dining/model";

const CANDIDATE_STATUS_LABEL: Record<DiningReleaseCandidate["status"], string> = {
	approved: "已审批",
	candidate: "候选",
	cancelled: "已取消",
	failed: "失败",
	published: "已发布",
	publishing: "发布中",
	scheduled: "已定时",
	validated: "已校验",
};

export function ReleasesPage() {
	const queryClient = useQueryClient();
	const [notes, setNotes] = useState("");
	const [approvalNotes, setApprovalNotes] = useState("确认发布");
	const candidatesQuery = useQuery({
		queryFn: listDiningReleaseCandidates,
		queryKey: ["dining-ops", "release-candidates"],
	});
	const releasesQuery = useQuery({
		queryFn: listDiningReleases,
		queryKey: ["dining-ops", "releases"],
	});
	const refreshReleaseData = () => {
		void queryClient.invalidateQueries({ queryKey: ["dining-ops", "release-candidates"] });
		void queryClient.invalidateQueries({ queryKey: ["dining-ops", "releases"] });
	};
	const createMutation = useMutation({
		mutationFn: () => createDiningReleaseCandidate({ notes }),
		onSuccess: () => {
			setNotes("");
			refreshReleaseData();
		},
	});
	const validateMutation = useMutation({
		mutationFn: validateDiningReleaseCandidate,
		onSuccess: refreshReleaseData,
	});
	const approveMutation = useMutation({
		mutationFn: approveDiningReleaseCandidate,
		onSuccess: refreshReleaseData,
	});
	const publishMutation = useMutation({
		mutationFn: publishDiningReleaseCandidate,
		onSuccess: refreshReleaseData,
	});

	return (
		<section className="space-y-4">
			<div className="ops-panel p-5">
				<p className="ops-eyebrow">候选发布</p>
				<h2 className="ops-title">食堂发布工作台</h2>
				<p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
					发布只能从候选开始。候选会冻结当前草稿版本、SVG
					资产、锚点绑定和快照哈希，校验通过后才能审批和发布。
				</p>
				<form
					className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						createMutation.mutate();
					}}
				>
					<label className="ops-field">
						<span>候选说明</span>
						<input value={notes} onChange={(event) => setNotes(event.target.value)} />
					</label>
					<button
						className="ops-primary-button self-end"
						disabled={!notes || createMutation.isPending}
						type="submit"
					>
						<GitBranch aria-hidden="true" className="size-4" />
						创建候选
					</button>
				</form>
			</div>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
				<section className="ops-panel overflow-hidden">
					<div className="border-slate-200 border-b p-4">
						<p className="ops-eyebrow">Candidates</p>
						<h3 className="font-bold text-slate-800">发布候选</h3>
					</div>
					<div className="overflow-x-auto">
						<table className="ops-table">
							<thead>
								<tr>
									<th>候选</th>
									<th>状态</th>
									<th>草稿版本</th>
									<th>快照</th>
									<th>操作</th>
								</tr>
							</thead>
							<tbody>
								{candidatesQuery.data?.candidates.map((candidate) => (
									<tr key={candidate.candidateId}>
										<td className="font-mono text-xs">{candidate.candidateId}</td>
										<td>{CANDIDATE_STATUS_LABEL[candidate.status]}</td>
										<td className="font-mono text-xs">{candidate.baseDraftVersionId}</td>
										<td className="font-mono text-xs">{candidate.snapshotHash}</td>
										<td>
											<div className="flex flex-wrap gap-2">
												<button
													className="ops-secondary-button"
													disabled={validateMutation.isPending}
													onClick={() =>
														validateMutation.mutate({ candidateId: candidate.candidateId })
													}
													type="button"
												>
													<ShieldCheck aria-hidden="true" className="size-4" />
													校验
												</button>
												<button
													className="ops-secondary-button"
													disabled={
														approveMutation.isPending ||
														!["candidate", "validated", "approved"].includes(candidate.status)
													}
													onClick={() =>
														approveMutation.mutate({
															candidateId: candidate.candidateId,
															notes: approvalNotes,
														})
													}
													type="button"
												>
													<CheckCircle2 aria-hidden="true" className="size-4" />
													审批
												</button>
												<button
													className="ops-primary-button"
													disabled={
														publishMutation.isPending ||
														!["approved", "scheduled"].includes(candidate.status)
													}
													onClick={() =>
														publishMutation.mutate({ candidateId: candidate.candidateId })
													}
													type="button"
												>
													<Rocket aria-hidden="true" className="size-4" />
													发布候选
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{candidatesQuery.data?.candidates.length === 0 ? (
						<EmptyState icon={GitBranch} text="还没有发布候选。" />
					) : null}
				</section>

				<section className="ops-panel p-4">
					<p className="ops-eyebrow">Approval</p>
					<h3 className="font-bold text-slate-800">审批说明</h3>
					<label className="ops-field mt-3">
						<span>审批备注</span>
						<input
							value={approvalNotes}
							onChange={(event) => setApprovalNotes(event.target.value)}
						/>
					</label>
					<div className="mt-4 grid gap-2 text-sm text-slate-600">
						<StatusLine icon={ShieldCheck} text="校验报告有 blocker 时审批会被拒绝。" />
						<StatusLine icon={Clock} text="定时发布只允许指向已审批候选。" />
						<StatusLine icon={XCircle} text="草稿变更后的旧候选会被判定为 stale。" />
					</div>
				</section>
			</div>

			<section className="ops-panel overflow-hidden">
				<div className="border-slate-200 border-b p-4">
					<p className="ops-eyebrow">Releases</p>
					<h3 className="font-bold text-slate-800">已发布快照</h3>
				</div>
				<div className="overflow-x-auto">
					<table className="ops-table">
						<thead>
							<tr>
								<th>Release</th>
								<th>候选</th>
								<th>说明</th>
								<th>发布时间</th>
							</tr>
						</thead>
						<tbody>
							{releasesQuery.data?.releases.map((release) => (
								<tr key={release.releaseId}>
									<td className="font-mono text-xs">{release.releaseId}</td>
									<td className="font-mono text-xs">{release.candidateId ?? "-"}</td>
									<td>{release.notes}</td>
									<td>{release.publishedAt ?? "-"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</section>
	);
}

function StatusLine(input: {
	icon: React.ComponentType<{ "aria-hidden": "true"; className: string }>;
	text: string;
}) {
	const Icon = input.icon;
	return (
		<p className="flex items-center gap-2">
			<Icon aria-hidden="true" className="size-4 text-slate-500" />
			{input.text}
		</p>
	);
}

function EmptyState(input: {
	icon: React.ComponentType<{ "aria-hidden": "true"; className: string }>;
	text: string;
}) {
	const Icon = input.icon;
	return (
		<div className="flex items-center gap-2 p-4 text-sm text-slate-500">
			<Icon aria-hidden="true" className="size-4" />
			{input.text}
		</div>
	);
}
