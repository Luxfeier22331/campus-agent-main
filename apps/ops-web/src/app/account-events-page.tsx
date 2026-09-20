import { ActionGroup, Button, Input, NativeSelect, StateMessage } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { AccountAdminEvent } from "campus-contracts/account-admin";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountOutcomeBadge, accountActionLabel } from "./account-admin-display";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { formatId, formatTimestamp } from "./format";
import { fetchAccountAdminEvents } from "./ops-api/account-admin";
import { ErrorState, PageHeader } from "./ops-display";
import { replaceTimeQuery, type TimeSearch, timeQueryFields } from "./time-filters";
import { DataTable } from "./ui/data-table";
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
						variant="outline"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="查询运维人员执行的账号操作及其结果。"
				title="账号操作记录"
			/>
			<form
				className="mb-4 flex flex-wrap items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					setSearch({
						...filters,
						actorId: actorId.trim() || undefined,
						targetUserId: targetUserId.trim() || undefined,
					});
				}}
			>
				<TimeRangeFilter
					search={search}
					scope="accountEvents"
					onChange={(time) => setSearch(replaceTimeQuery(search, time))}
				/>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-event-action">
					操作
					<NativeSelect
						className="min-h-10"
						id="account-event-action"
						onChange={(event) =>
							setSearch({
								...filters,
								action: (event.target.value || undefined) as
									| AccountAdminEvent["action"]
									| undefined,
							})
						}
						value={search.action ?? ""}
					>
						<option value="">全部操作</option>
						{actions.map((action) => (
							<option key={action} value={action}>
								{accountActionLabel(action)}
							</option>
						))}
					</NativeSelect>
				</label>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-event-outcome">
					结果
					<NativeSelect
						className="min-h-10"
						id="account-event-outcome"
						onChange={(event) =>
							setSearch({
								...filters,
								outcome: (event.target.value || undefined) as
									| AccountAdminEvent["outcome"]
									| undefined,
							})
						}
						value={search.outcome ?? ""}
					>
						<option value="">全部结果</option>
						<option value="succeeded">成功</option>
						<option value="failed">失败</option>
						<option value="started">执行中</option>
						<option value="indeterminate">结果未确认</option>
					</NativeSelect>
				</label>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-event-actor">
					操作者
					<Input
						className="min-h-10"
						id="account-event-actor"
						onChange={(event) => setActorId(event.target.value)}
						value={actorId}
					/>
				</label>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-event-target">
					目标用户 ID
					<Input
						className="min-h-10"
						id="account-event-target"
						onChange={(event) => setTargetUserId(event.target.value)}
						value={targetUserId}
					/>
				</label>
				<Button type="submit">
					<Search className="size-4" />
					查询
				</Button>
			</form>
			{events.isPending && !search.timeError ? (
				<StateMessage layout="inline" role="status" description={<> 正在读取操作记录... </>} />
			) : null}
			{events.isError ? (
				<ErrorState
					error={events.error}
					onRetry={() => void events.refetch()}
					title="操作记录读取失败"
				/>
			) : events.data && !search.timeError ? (
				<>
					<TimeRangeSummary filters={events.data.filters} />
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
								cell: (row) => (row.actor ? `${row.actor.name} (${row.actor.email})` : row.actorId),
								cellClassName: "hidden md:table-cell",
								header: "操作者",
								headerClassName: "hidden md:table-cell",
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
								headerClassName: "hidden lg:table-cell",
								cellClassName: "hidden lg:table-cell",
								id: "target",
							},
							{
								cell: (row) => row.reason ?? "-",
								cellClassName: "hidden xl:table-cell",
								header: "原因",
								headerClassName: "hidden xl:table-cell",
								id: "reason",
							},
							{
								cell: (row) => <AccountOutcomeBadge outcome={row.outcome} />,
								header: "结果",
								id: "outcome",
							},
							{
								cell: (row) => row.errorCode ?? "-",
								cellClassName: "hidden xl:table-cell",
								header: "错误码",
								headerClassName: "hidden xl:table-cell",
								id: "error",
							},
						]}
						data={events.data.items}
						emptyMessage="没有符合筛选条件的操作记录。"
						minWidth="0"
						rowKey={(row) => row.eventId}
					/>
					<ActionGroup className="mt-4">
						<Button
							disabled={history.length === 0}
							onClick={() => {
								const previous = history.slice();
								const cursor = previous.pop() || undefined;
								setSearch({ ...filters, cursor, history: encodeCursorHistory(previous) });
							}}
							variant="outline"
						>
							上一页
						</Button>
						<Button
							disabled={!events.data.nextCursor}
							onClick={() =>
								setSearch({
									...filters,
									cursor: events.data?.nextCursor ?? undefined,
									history: encodeCursorHistory([...history, search.cursor ?? ""]),
								})
							}
							variant="outline"
						>
							下一页
						</Button>
					</ActionGroup>
				</>
			) : (
				<p className="text-muted-foreground text-sm">正在读取操作记录...</p>
			)}
		</section>
	);
}
