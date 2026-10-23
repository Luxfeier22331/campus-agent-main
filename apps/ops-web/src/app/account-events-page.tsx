import {
	ActionGroup,
	Button,
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	StateMessage,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { AccountAdminEvent } from "campus-contracts/account-admin";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountOutcomeBadge, accountActionLabel } from "./account-admin-display";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { formatId, formatTimestamp } from "./format";
import { fetchAccountAdminEvents } from "./ops-api/account-admin";
import { ErrorState, PageHeader, StaleDataWarning } from "./ops-display";
import { replaceTimeQuery, type TimeSearch, timeQueryFields } from "./time-filters";
import { DataTable } from "./ui/data-table";
import { FilterSelect } from "./ui/filter-select";
import { TimeRangeFilter, TimeRangeSummary } from "./ui/time-window-select";

const actions: AccountAdminEvent["action"][] = [
	"password_reset_email_sent",
	"verification_email_sent",
	"session_revoked",
	"sessions_revoked",
	"account_banned",
	"account_unbanned",
	"temporary_password_issued",
];

export interface AccountEventsSearch extends TimeSearch {
	action?: AccountAdminEvent["action"] | undefined;
	actorId?: string | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
	outcome?: AccountAdminEvent["outcome"] | undefined;
	targetUserId?: string | undefined;
}

export function AccountEventsPage({ search }: { search: AccountEventsSearch }) {
	const navigate = useNavigate({ from: "/users/activity" });
	const currentHref = useRouterState({ select: (state) => state.location.href });
	const [actorId, setActorId] = useState(search.actorId ?? "");
	const [targetUserId, setTargetUserId] = useState(search.targetUserId ?? "");
	useEffect(() => setActorId(search.actorId ?? ""), [search.actorId]);
	useEffect(() => setTargetUserId(search.targetUserId ?? ""), [search.targetUserId]);
	const history = decodeCursorHistory(search.history);
	const filterKey = JSON.stringify({ ...search, cursor: undefined, history: undefined });
	const events = useQuery<Awaited<ReturnType<typeof fetchAccountAdminEvents>>>({
		enabled: !search.timeError,
		placeholderData: (previous, previousQuery) =>
			previousQuery?.queryKey[2] === filterKey ? previous : undefined,
		queryFn: ({ signal }) =>
			fetchAccountAdminEvents(
				{
					...(search.action ? { action: search.action } : {}),
					...(search.actorId ? { actorId: search.actorId } : {}),
					...(search.cursor ? { cursor: search.cursor } : {}),
					limit: 50,
					...(search.outcome ? { outcome: search.outcome } : {}),
					...(search.targetUserId ? { targetUserId: search.targetUserId } : {}),
					...timeQueryFields(search),
				},
				{ signal },
			),
		queryKey: ["ops", "account-events", filterKey, search.cursor],
	});
	const setSearch = (next: AccountEventsSearch) => void navigate({ search: next });
	const filters = {
		action: search.action,
		actorId: search.actorId,
		outcome: search.outcome,
		targetUserId: search.targetUserId,
		...timeQueryFields(search),
	};

	return (
		<section>
			<PageHeader
				actions={
					<Button
						disabled={events.isFetching}
						onClick={() => void events.refetch()}
						variant="ghost"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="查询运维人员执行的账号操作及其结果。"
				title="账号操作记录"
			/>
			<form
				className="ops-filter-bar mb-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-3"
				onSubmit={(event) => {
					event.preventDefault();
					setSearch({
						...filters,
						actorId: actorId.trim() || undefined,
						targetUserId: targetUserId.trim() || undefined,
					});
				}}
			>
				<div className="ops-time-filter">
					<TimeRangeFilter
						search={search}
						scope="accountEvents"
						onChange={(time) => setSearch(replaceTimeQuery(search, time))}
					/>
				</div>
				<Field label="操作">
					<FilterSelect
						className="min-h-11"
						id="account-event-action"
						onValueChange={(nextValue) =>
							setSearch({
								...filters,
								action: (nextValue || undefined) as AccountAdminEvent["action"] | undefined,
							})
						}
						value={search.action ?? ""}
						options={[
							{ value: "", label: "全部操作" },
							...actions.map((action) => ({
								value: action,
								label: accountActionLabel(action),
							})),
						]}
					/>
				</Field>
				<Field label="结果">
					<FilterSelect
						className="min-h-11"
						id="account-event-outcome"
						onValueChange={(nextValue) =>
							setSearch({
								...filters,
								outcome: (nextValue || undefined) as AccountAdminEvent["outcome"] | undefined,
							})
						}
						value={search.outcome ?? ""}
						options={[
							{ value: "", label: "全部结果" },
							{ value: "succeeded", label: "成功" },
							{ value: "failed", label: "失败" },
							{ value: "started", label: "执行中" },
							{ value: "indeterminate", label: "结果未确认" },
						]}
					/>
				</Field>
				<Field label="操作者">
					<Input
						className="min-h-11"
						id="account-event-actor"
						onChange={(event) => setActorId(event.target.value)}
						value={actorId}
					/>
				</Field>
				<Field label="目标用户 ID">
					<Input
						className="min-h-11"
						id="account-event-target"
						onChange={(event) => setTargetUserId(event.target.value)}
						value={targetUserId}
					/>
				</Field>
				<Button type="submit">
					<Search className="size-4" />
					查询
				</Button>
			</form>
			{events.isError && !events.data ? (
				<ErrorState
					error={events.error}
					onRetry={() => void events.refetch()}
					title="操作记录读取失败"
				/>
			) : events.data && !search.timeError ? (
				<>
					{events.isError ? (
						<StaleDataWarning
							error={events.error}
							lastSuccessfulAt={events.dataUpdatedAt}
							onRetry={() => void events.refetch()}
							title="操作记录刷新失败"
						/>
					) : null}
					<TimeRangeSummary filters={events.data.filters} />
					<div className="hidden md:block">
						<DataTable<AccountAdminEvent>
							busy={events.isFetching}
							caption="账号操作记录"
							columns={[
								{
									cell: (row) => formatTimestamp(row.occurredAt),
									header: "时间",
									id: "time",
									rowHeader: true,
								},
								{ cell: (row) => accountActionLabel(row.action), header: "操作", id: "action" },
								{
									cell: (row) =>
										row.actor ? `${row.actor.name} (${row.actor.email})` : row.actorId,

									header: "操作者",

									id: "actor",
								},
								{
									cell: (row) =>
										row.targetUserId ? (
											<Link
												params={{ userId: row.targetUserId }}
												search={{ from: currentHref }}
												title={row.targetUser ? undefined : row.targetUserId}
												to="/users/$userId"
											>
												{row.targetUser
													? `${row.targetUser.name}（${row.targetUser.email}）`
													: formatId(row.targetUserId)}
											</Link>
										) : (
											"-"
										),
									header: "目标用户",

									id: "target",
								},
								{
									cell: (row) => row.reason ?? "-",

									header: "原因",

									id: "reason",
								},
								{
									cell: (row) => <AccountOutcomeBadge outcome={row.outcome} />,
									header: "结果",
									id: "outcome",
								},
								{
									cell: (row) => row.errorCode ?? "-",

									header: "错误码",

									id: "error",
								},
							]}
							data={events.data.items}
							emptyMessage="没有符合筛选条件的操作记录。"
							minWidth="960px"
							rowKey={(row) => row.eventId}
						/>
					</div>
					<div className="md:hidden">
						{events.data.items.length === 0 ? (
							<StateMessage description="没有符合筛选条件的操作记录。" />
						) : (
							<ul
								aria-label="账号操作记录"
								className="divide-y divide-border border-y border-border"
							>
								{events.data.items.map((event) => (
									<li
										key={event.eventId}
										className="min-w-0 space-y-3 py-4 text-sm [overflow-wrap:anywhere]"
									>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<span className="font-medium">{accountActionLabel(event.action)}</span>
											<AccountOutcomeBadge outcome={event.outcome} />
										</div>
										<p className="text-xs text-muted-foreground">
											{formatTimestamp(event.occurredAt)}
										</p>
										<dl className="grid gap-2">
											<div>
												<dt className="text-muted-foreground">操作者</dt>
												<dd>
													{event.actor
														? `${event.actor.name}（${event.actor.email}）`
														: event.actorId}
												</dd>
											</div>
											<div>
												<dt className="text-muted-foreground">目标用户</dt>
												<dd>
													{event.targetUserId ? (
														<Link
															className="inline-flex min-h-11 items-center text-link hover:underline"
															to="/users/$userId"
															params={{ userId: event.targetUserId }}
															search={{ from: currentHref }}
														>
															{event.targetUser
																? `${event.targetUser.name}（${event.targetUser.email}）`
																: event.targetUserId}
														</Link>
													) : (
														"—"
													)}
												</dd>
											</div>
										</dl>
										{event.reason || event.errorCode ? (
											<Disclosure>
												<DisclosureSummary>原因与错误详情</DisclosureSummary>
												<dl className="mt-2 grid gap-2">
													{event.reason ? (
														<div>
															<dt>原因</dt>
															<dd>{event.reason}</dd>
														</div>
													) : null}
													{event.errorCode ? (
														<div>
															<dt>错误码</dt>
															<dd className="font-mono text-xs">{event.errorCode}</dd>
														</div>
													) : null}
												</dl>
											</Disclosure>
										) : null}
									</li>
								))}
							</ul>
						)}
					</div>
					<ActionGroup className="mt-4">
						<Button
							disabled={events.isFetching || history.length === 0}
							onClick={() => {
								const previous = history.slice();
								const cursor = previous.pop() || undefined;
								setSearch({ ...filters, cursor, history: encodeCursorHistory(previous) });
							}}
							variant="ghost"
						>
							上一页
						</Button>
						<Button
							disabled={events.isFetching || !events.data.nextCursor}
							onClick={() =>
								setSearch({
									...filters,
									cursor: events.data?.nextCursor ?? undefined,
									history: encodeCursorHistory([...history, search.cursor ?? ""]),
								})
							}
							variant="ghost"
						>
							下一页
						</Button>
					</ActionGroup>
				</>
			) : search.timeError ? null : (
				<StateMessage layout="inline" role="status" description="正在读取操作记录..." />
			)}
		</section>
	);
}
