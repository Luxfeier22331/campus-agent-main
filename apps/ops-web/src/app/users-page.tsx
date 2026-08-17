import { Button, Input, NativeSelect } from "@campus-agent/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type {
	AccountAdminAccessState,
	AccountAdminState,
	AccountAdminUserSummary,
} from "campus-contracts/account-admin";
import { ChevronLeft, ChevronRight, RefreshCw, Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountAccessBadge, AccountStateBadge, accountStateLabel } from "./account-admin-display";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { formatTimestamp } from "./format";
import { fetchAccountAdminUsers } from "./ops-api/account-admin";
import { ErrorState, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";

const states: AccountAdminState[] = [
	"active",
	"unverified",
	"password_change_required",
	"banned",
	"deleting",
];

export interface UsersSearch {
	access?: AccountAdminAccessState | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
	q?: string | undefined;
	state?: AccountAdminState | undefined;
}

export function UsersPage({ search }: { search: UsersSearch }) {
	const navigate = useNavigate({ from: "/users" });
	const currentHref = useRouterState({ select: (state) => state.location.href });
	const [queryInput, setQueryInput] = useState(search.q ?? "");
	useEffect(() => setQueryInput(search.q ?? ""), [search.q]);
	const history = decodeCursorHistory(search.history);
	const hasFilters = Boolean(search.access || search.q || search.state);
	const users = useQuery({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) =>
			fetchAccountAdminUsers(
				{
					...(search.access ? { access: search.access } : {}),
					...(search.cursor ? { cursor: search.cursor } : {}),
					limit: 50,
					...(search.q ? { query: search.q } : {}),
					...(search.state ? { state: search.state } : {}),
				},
				{ signal },
			),
		queryKey: ["ops", "users", search],
	});
	const setSearch = (next: UsersSearch) => void navigate({ replace: false, search: next });

	return (
		<section>
			<PageHeader
				actions={
					<Button
						disabled={users.isFetching}
						onClick={() => void users.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="查询认证账号、验证状态、封禁状态和当前会话。"
				title="用户管理"
			/>
			<form
				className="mb-4 flex flex-wrap items-end gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					setSearch({
						access: search.access,
						q: queryInput.trim() || undefined,
						state: search.state,
					});
				}}
			>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-user-query">
					用户
					<Input
						className="min-h-10 w-72 max-w-full"
						id="account-user-query"
						name="q"
						onChange={(event) => setQueryInput(event.target.value)}
						placeholder="姓名前缀、完整邮箱或用户 ID"
						value={queryInput}
					/>
				</label>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-user-access">
					访问状态
					<NativeSelect
						className="min-h-10"
						id="account-user-access"
						onChange={(event) =>
							setSearch({
								access: (event.target.value || undefined) as AccountAdminAccessState | undefined,
								q: search.q,
								state: search.state,
							})
						}
						value={search.access ?? ""}
					>
						<option value="">全部权限</option>
						<option value="allowed">可访问</option>
						<option value="denied">不可访问</option>
					</NativeSelect>
				</label>
				<label className="grid gap-1 text-muted-foreground text-xs" htmlFor="account-user-state">
					账号状态
					<NativeSelect
						className="min-h-10"
						id="account-user-state"
						name="state"
						onChange={(event) =>
							setSearch({
								access: search.access,
								q: search.q,
								state: (event.target.value || undefined) as AccountAdminState | undefined,
							})
						}
						value={search.state ?? ""}
					>
						<option value="">全部状态</option>
						{states.map((value) => (
							<option key={value} value={value}>
								{accountStateLabel(value)}
							</option>
						))}
					</NativeSelect>
				</label>
				<Button type="submit">
					<Search className="size-4" />
					查询
				</Button>
				{hasFilters ? (
					<Button
						onClick={() => {
							setQueryInput("");
							setSearch({});
						}}
						variant="ghost"
					>
						<X className="size-4" />
						清除筛选
					</Button>
				) : null}
			</form>

			{users.isError ? (
				<ErrorState error={users.error} onRetry={() => void users.refetch()} title="用户读取失败" />
			) : users.data ? (
				<>
					{users.isFetching ? (
						<p className="mb-2 text-muted-foreground text-sm" role="status">
							正在更新结果...
						</p>
					) : null}
					<DataTable<AccountAdminUserSummary>
						busy={users.isFetching}
						caption="用户列表"
						columns={[
							{
								cell: (row) => (
									<div className="grid min-w-0 gap-0.5">
										<span className="font-medium text-foreground">{row.name}</span>
										<span className="break-all text-muted-foreground text-xs">{row.email}</span>
									</div>
								),
								header: "用户",
								id: "user",
								rowHeader: true,
							},
							{
								cell: (row) => <AccountStateBadge state={row.state} />,
								header: "账号状态",
								id: "state",
							},
							{
								cell: (row) => (
									<AccountAccessBadge source={row.accessSource} state={row.accessState} />
								),
								header: "访问状态",
								id: "access",
							},
							{
								cell: (row) => row.activeSessionCount,
								cellClassName: "hidden sm:table-cell",
								header: "有效会话",
								headerClassName: "hidden sm:table-cell",
								id: "sessions",
							},
							{
								cell: (row) => formatTimestamp(row.createdAt),
								cellClassName: "hidden lg:table-cell",
								header: "注册时间",
								headerClassName: "hidden lg:table-cell",
								id: "created",
							},
							{
								cell: (row) => (
									<Button asChild className="min-h-9 px-2" variant="outline">
										<Link
											params={{ userId: row.id }}
											search={{ from: currentHref }}
											to="/users/$userId"
										>
											<UserRound className="size-4" />
											详情
										</Link>
									</Button>
								),
								header: "操作",
								id: "actions",
								stickyRight: true,
							},
						]}
						data={users.data.items}
						emptyMessage={hasFilters ? "没有符合筛选条件的用户。" : "系统中还没有用户。"}
						minWidth="0"
						rowKey={(row) => row.id}
						tableClassName="table-fixed sm:table-auto"
					/>
					<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
						<p className="text-muted-foreground text-sm">
							第 {history.length + 1} 页，本页 {users.data.items.length} 位用户
						</p>
						<div className="flex gap-2">
							<Button
								disabled={users.isFetching || history.length === 0}
								onClick={() => {
									const previous = history.slice();
									const cursor = previous.pop();
									setSearch({
										access: search.access,
										cursor,
										history: encodeCursorHistory(previous),
										q: search.q,
										state: search.state,
									});
								}}
								variant="outline"
							>
								<ChevronLeft className="size-4" />
								上一页
							</Button>
							<Button
								disabled={users.isFetching || !users.data.nextCursor}
								onClick={() =>
									setSearch({
										access: search.access,
										cursor: users.data?.nextCursor ?? undefined,
										history: encodeCursorHistory([...history, search.cursor ?? ""]),
										q: search.q,
										state: search.state,
									})
								}
								variant="outline"
							>
								下一页
								<ChevronRight className="size-4" />
							</Button>
						</div>
					</div>
				</>
			) : (
				<p className="text-muted-foreground text-sm">正在读取用户...</p>
			)}
		</section>
	);
}
