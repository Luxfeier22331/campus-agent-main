import { Button } from "@campus-agent/ui";
import type { AccountAdminEvent, AccountAdminSession } from "campus-contracts/account-admin";
import { AccountOutcomeBadge, accountActionLabel } from "./account-admin-display";
import { formatTimestamp } from "./format";
import { DataTable } from "./ui/data-table";

export function UserDetailSessionsTable({
	commandPending,
	onRevoke,
	sessions,
}: {
	commandPending: boolean;
	onRevoke: (sessionId: string) => void;
	sessions: AccountAdminSession[];
}) {
	return (
		<div className="mt-6">
			<h2 className="mb-3 font-semibold text-foreground text-lg">会话</h2>
			<DataTable<AccountAdminSession>
				caption="用户会话"
				columns={[
					{
						cell: (row) => formatTimestamp(row.createdAt),
						cellClassName: "hidden sm:table-cell",
						header: "创建时间",
						headerClassName: "hidden sm:table-cell",
						id: "created",
					},
					{
						cell: (row) => (
							<span className={row.isActive ? "text-success" : "text-muted-foreground"}>
								{row.isActive ? "有效" : "已过期"} · {formatTimestamp(row.expiresAt)}
							</span>
						),
						header: "到期时间",
						id: "expires",
						rowHeader: true,
					},
					{
						cell: (row) => row.ipAddress ?? "-",
						cellClassName: "hidden md:table-cell",
						header: "IP 地址",
						headerClassName: "hidden md:table-cell",
						id: "ip",
					},
					{
						cell: (row) => row.userAgent ?? "-",
						cellClassName: "hidden lg:table-cell",
						header: "客户端",
						headerClassName: "hidden lg:table-cell",
						id: "client",
					},
					{
						cell: (row) => (
							<Button
								disabled={commandPending || !row.isActive}
								onClick={() => onRevoke(row.id)}
								variant="ghost"
							>
								撤销
							</Button>
						),
						header: "操作",
						id: "actions",
						stickyRight: true,
					},
				]}
				data={sessions}
				emptyMessage="该用户当前没有会话。"
				minWidth="0"
				rowKey={(row) => row.id}
			/>
		</div>
	);
}

export function UserDetailEventsTable({ events }: { events: AccountAdminEvent[] }) {
	return (
		<div className="mt-6">
			<h2 className="mb-3 font-semibold text-foreground text-lg">操作记录</h2>
			<DataTable<AccountAdminEvent>
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
						cell: (row) => row.actorId,
						cellClassName: "hidden md:table-cell",
						header: "操作者",
						headerClassName: "hidden md:table-cell",
						id: "actor",
					},
					{
						cell: (row) => row.reason ?? "-",
						cellClassName: "hidden lg:table-cell",
						header: "原因",
						headerClassName: "hidden lg:table-cell",
						id: "reason",
					},
					{
						cell: (row) => <AccountOutcomeBadge outcome={row.outcome} />,
						header: "结果",
						id: "outcome",
					},
				]}
				data={events}
				emptyMessage="该用户还没有账号操作记录。"
				minWidth="0"
				rowKey={(row) => row.eventId}
			/>
		</div>
	);
}
