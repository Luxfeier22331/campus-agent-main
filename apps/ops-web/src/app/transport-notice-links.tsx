import { formatWeekdays } from "@campus-agent/transport/domain";
import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
	Disclosure,
	DisclosureSummary,
	Input,
	Textarea,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { TransportNoticeLink } from "../server/transport-store-contract";
import { formatTimestamp } from "./format";
import { NoticePreviewPanel } from "./notices/notice-preview";
import { fetchNotices } from "./ops-api/notices";
import {
	fetchNoticeTransportPeriods,
	fetchTransportNoticeLinks,
	saveTransportNoticeLinks,
} from "./ops-api/transport";
import { ErrorState, InlineError } from "./ops-display";

export function TransportNoticePicker({
	value,
	onChange,
	disabled = false,
}: {
	value: TransportNoticeLink[];
	onChange: (links: TransportNoticeLink[]) => void;
	disabled?: boolean;
}) {
	const [search, setSearch] = useState("");
	const [q, setQ] = useState("");
	const [page, setPage] = useState(1);
	const [searching, setSearching] = useState(false);
	const [preview, setPreview] = useState<{ noticeId: number; title: string } | null>(null);
	const results = useQuery({
		queryKey: ["transport-notice-search", q, page],
		queryFn: ({ signal }) => fetchNotices({ page, q, signal }),
		enabled: searching,
	});
	return (
		<section aria-label="关联通知" className="grid gap-3 rounded-lg border p-4">
			<h3 className="font-medium">关联通知</h3>
			{value.length === 0 ? (
				<p className="text-sm text-muted-foreground">尚未关联通知，线下安排可留空。</p>
			) : null}
			<ul className="grid gap-3">
				{value.map((link) => (
					<li key={link.noticeId} className="grid gap-2 rounded border p-3">
						<div className="flex items-start justify-between gap-2">
							<button
								type="button"
								className="min-h-11 text-left text-link underline underline-offset-4"
								onClick={() => setPreview(link)}
							>
								{link.title}
							</button>
							<Button
								disabled={disabled}
								size="sm"
								variant="ghost"
								aria-label={`移除关联 ${link.noticeId}`}
								onClick={() => onChange(value.filter((item) => item.noticeId !== link.noticeId))}
							>
								移除
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							#{link.noticeId} · {formatTimestamp(link.releasedAt)} ·{" "}
							{link.isPublished ? "已发布" : "未发布"}
						</p>
						<label className="grid gap-1 text-sm" htmlFor={`notice-link-summary-${link.noticeId}`}>
							运营关联说明（可空，仅后台可见）
							<Textarea
								id={`notice-link-summary-${link.noticeId}`}
								aria-label={`通知 ${link.noticeId} 关联说明`}
								disabled={disabled}
								maxLength={1000}
								value={link.summary ?? ""}
								onChange={(event) =>
									onChange(
										value.map((item) =>
											item.noticeId === link.noticeId
												? { ...item, summary: event.target.value || null }
												: item,
										),
									)
								}
							/>
						</label>
					</li>
				))}
			</ul>
			{searching ? (
				<div className="grid gap-3 border-t pt-3">
					<div className="flex gap-2">
						<Input
							aria-label="搜索关联通知"
							placeholder="通知标题或 ID"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									setQ(search.trim());
									setPage(1);
								}
							}}
						/>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setQ(search.trim());
								setPage(1);
							}}
						>
							搜索
						</Button>
					</div>
					{results.isPending ? <p role="status">正在读取通知…</p> : null}
					{results.error ? (
						<ErrorState
							error={results.error}
							title="通知搜索失败"
							onRetry={() => void results.refetch()}
						/>
					) : null}
					{results.data?.items.length === 0 ? (
						<p className="text-sm">没有符合条件的通知。</p>
					) : null}
					<ul className="divide-y">
						{results.data?.items.map((notice) => (
							<li key={notice.noticeId} className="flex items-start gap-2 py-2">
								<div className="min-w-0 flex-1">
									<button
										type="button"
										className="min-h-11 text-left text-sm text-link underline underline-offset-4"
										onClick={() => setPreview(notice)}
									>
										{notice.title}
									</button>
									<p className="text-xs text-muted-foreground">
										#{notice.noticeId} · {formatTimestamp(notice.releasedAt)} ·{" "}
										{notice.state === "published" ? "已发布" : "未发布"}
									</p>
								</div>
								<Button
									size="sm"
									variant="outline"
									disabled={disabled || value.some((link) => link.noticeId === notice.noticeId)}
									onClick={() =>
										onChange([
											...value,
											{
												noticeId: notice.noticeId,
												title: notice.title,
												releasedAt: notice.releasedAt,
												isPublished: notice.state === "published",
												summary: null,
											},
										])
									}
								>
									{value.some((link) => link.noticeId === notice.noticeId) ? "已选择" : "选择"}
								</Button>
							</li>
						))}
					</ul>
					<div className="flex items-center justify-between gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={page === 1 || results.isFetching}
							onClick={() => setPage(page - 1)}
						>
							上一页
						</Button>
						<span className="text-sm">
							第 {page} / {Math.max(1, results.data?.totalPages ?? 1)} 页
						</span>
						<Button
							size="sm"
							variant="outline"
							disabled={!results.data || page >= results.data.totalPages || results.isFetching}
							onClick={() => setPage(page + 1)}
						>
							下一页
						</Button>
					</div>
					<Button size="sm" variant="ghost" onClick={() => setSearching(false)}>
						收起搜索
					</Button>
				</div>
			) : (
				<Button disabled={disabled} variant="outline" onClick={() => setSearching(true)}>
					添加关联通知
				</Button>
			)}
			<Dialog
				open={preview !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPreview(null);
					}
				}}
			>
				<DialogContent className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden">
					<DialogTitle className="pr-8">{preview?.title ?? "通知预览"}</DialogTitle>
					<div data-notice-scroll className="min-h-0 overflow-y-auto overscroll-contain pr-2">
						{preview ? (
							<NoticePreviewPanel key={preview.noticeId} noticeId={preview.noticeId} />
						) : null}
					</div>
				</DialogContent>
			</Dialog>
		</section>
	);
}

export function TransportNoticeLinkEditor({
	scheduleId,
	onDirty,
	onBusy,
	onCancel,
	onSaved,
}: {
	scheduleId: string;
	onDirty: (dirty: boolean) => void;
	onBusy: (busy: boolean) => void;
	onCancel: () => void;
	onSaved: () => void;
}) {
	const [saving, setSaving] = useState(false);
	const reportBusy = useCallback(
		(busy: boolean) => {
			setSaving(busy);
			onBusy(busy);
		},
		[onBusy],
	);
	const links = useQuery({
		queryKey: ["transport-notice-links", scheduleId],
		queryFn: ({ signal }) => fetchTransportNoticeLinks(scheduleId, signal),
	});
	return (
		<section aria-label="维护关联通知" className="grid gap-4">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium">维护关联通知</h2>
				<Button variant="outline" disabled={saving} onClick={onCancel}>
					取消
				</Button>
			</div>
			{links.data ? (
				<NoticeLinkDraft
					key={scheduleId}
					scheduleId={scheduleId}
					initial={links.data.noticeLinks}
					onDirty={onDirty}
					onBusy={reportBusy}
					onSaved={onSaved}
				/>
			) : links.error ? (
				<ErrorState
					error={links.error}
					title="关联通知读取失败"
					onRetry={() => void links.refetch()}
				/>
			) : (
				<p role="status">正在读取关联通知…</p>
			)}
		</section>
	);
}

function NoticeLinkDraft({
	scheduleId,
	initial,
	onDirty,
	onBusy,
	onSaved,
}: {
	scheduleId: string;
	initial: TransportNoticeLink[];
	onDirty: (dirty: boolean) => void;
	onBusy: (busy: boolean) => void;
	onSaved: () => void;
}) {
	const [base] = useState(initial);
	const [links, setLinks] = useState(initial);
	const client = useQueryClient();
	const dirty = JSON.stringify(links) !== JSON.stringify(base);
	const save = useMutation({
		mutationFn: () =>
			saveTransportNoticeLinks(
				scheduleId,
				links.map(({ noticeId, summary }) => ({ noticeId, summary })),
			),
		onSuccess: (result) => {
			client.setQueryData(["transport-notice-links", scheduleId], result);
			void client.invalidateQueries({ queryKey: ["notice-transport-periods"] });
			void client.invalidateQueries({ queryKey: ["transport"] });
			onSaved();
		},
	});
	useEffect(() => onDirty(dirty), [dirty, onDirty]);
	useEffect(() => onBusy(save.isPending), [save.isPending, onBusy]);
	return (
		<div className="grid gap-4">
			<TransportNoticePicker value={links} onChange={setLinks} disabled={save.isPending} />
			<p className="text-sm text-muted-foreground">关联只用于查看通知；移除关联不会取消班次。</p>
			{save.error ? <InlineError error={save.error} title="关联保存失败" /> : null}
			<div className="flex gap-2">
				<Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
					{save.isPending ? "保存中…" : "保存关联"}
				</Button>
			</div>
		</div>
	);
}

export function NoticeTransportPeriods({
	noticeId,
	active,
}: {
	noticeId: number;
	active: boolean;
}) {
	const [open, setOpen] = useState(false);
	const query = useQuery({
		queryKey: ["notice-transport-periods", noticeId],
		queryFn: ({ signal }) => fetchNoticeTransportPeriods(noticeId, signal),
		enabled: active && open,
	});
	return (
		<Disclosure
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
			className="border-t pt-3"
		>
			<DisclosureSummary>关联班车安排</DisclosureSummary>
			{open ? (
				<div className="grid gap-3 pt-3">
					{query.isPending ? <p role="status">正在读取班车安排…</p> : null}
					{query.error ? (
						<ErrorState
							error={query.error}
							title="班车安排读取失败"
							onRetry={() => void query.refetch()}
						/>
					) : null}
					{query.data?.schedulePeriods.length === 0 ? (
						<p className="text-sm text-muted-foreground">尚未关联班车安排。</p>
					) : null}
					{query.data?.schedulePeriods.map((period) => (
						<section key={period.scheduleId} className="grid gap-1 rounded border p-3 text-sm">
							<h4 className="font-medium">
								{period.origin} → {period.destination}
							</h4>
							<p>
								{period.validFrom} — {period.validTo ?? "长期"} · {formatWeekdays(period.weekdays)}{" "}
								· {period.status === "operating" ? "运行" : "停运"}
							</p>
							{period.summary ? <p>{period.summary}</p> : null}
							<Link
								className="inline-flex min-h-11 items-center text-link underline underline-offset-4"
								to="/transport"
								search={{ scheduleId: period.scheduleId }}
							>
								查看排班
							</Link>
						</section>
					))}
				</div>
			) : null}
		</Disclosure>
	);
}
