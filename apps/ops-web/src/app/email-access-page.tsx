import { Badge, Button, Checkbox, Input, NativeSelect } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	EmailAccessGrant,
	EmailAccessGrantKind,
	EmailAccessGrantState,
} from "campus-contracts/email-access";
import { MailPlus, RefreshCw, RotateCw, ShieldX } from "lucide-react";
import { useState } from "react";
import { formatTimestamp } from "./format";
import {
	commandEmailAccessGrant,
	createEmailAccessGrant,
	fetchEmailAccessGrants,
} from "./ops-api-client";
import { ErrorState, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";

const stateLabels: Record<EmailAccessGrantState, string> = {
	active: "有效",
	expired: "已过期",
	pending: "待领取",
	revoked: "已撤销",
};

const kindLabels: Record<EmailAccessGrantKind, string> = {
	invitation: "正式邀请",
	test: "测试授权",
};

export function EmailAccessPage() {
	const queryClient = useQueryClient();
	const [emailFilter, setEmailFilter] = useState("");
	const [kindFilter, setKindFilter] = useState<EmailAccessGrantKind | "">("");
	const [stateFilter, setStateFilter] = useState<EmailAccessGrantState | "">("");
	const [cursor, setCursor] = useState<string | undefined>();
	const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
	const [commandError, setCommandError] = useState<unknown>(null);
	const grants = useQuery({
		queryFn: ({ signal }) =>
			fetchEmailAccessGrants(
				{
					cursor,
					email: emailFilter.trim() || undefined,
					kind: kindFilter || undefined,
					state: stateFilter || undefined,
				},
				{ signal },
			),
		queryKey: ["ops", "email-access", { cursor, emailFilter, kindFilter, stateFilter }],
	});
	const refresh = async () => {
		setCommandError(null);
		await queryClient.invalidateQueries({ queryKey: ["ops", "email-access"] });
	};
	const createGrant = useMutation({
		mutationFn: (input: { email: string; kind: EmailAccessGrantKind; accessDays: number }) =>
			createEmailAccessGrant(
				{
					email: input.email,
					kind: input.kind,
					...(input.kind === "test"
						? {
								accessExpiresAt: new Date(
									Date.now() + input.accessDays * 24 * 60 * 60 * 1_000,
								).toISOString(),
							}
						: {}),
				},
				{ idempotencyKey: crypto.randomUUID() },
			),
		onError: setCommandError,
		onSuccess: refresh,
	});
	const commandGrant = useMutation({
		mutationFn: (input: { action: "resend" | "revoke"; grantId: string }) =>
			commandEmailAccessGrant(input.grantId, input.action, {
				idempotencyKey: crypto.randomUUID(),
			}),
		onError: setCommandError,
		onSuccess: refresh,
	});

	if (grants.isPending) {
		return (
			<section>
				<PageHeader description="管理校园邮箱之外的按地址邀请和限时测试授权。" title="账号准入" />
				<p className="text-muted-foreground text-sm">正在读取授权...</p>
			</section>
		);
	}
	if (grants.isError || !grants.data) {
		return (
			<section>
				<PageHeader description="管理校园邮箱之外的按地址邀请和限时测试授权。" title="账号准入" />
				<ErrorState
					error={grants.error}
					onRetry={() => void grants.refetch()}
					title="账号准入读取失败"
				/>
			</section>
		);
	}

	const data = grants.data;
	return (
		<section>
			<PageHeader
				actions={
					<Button
						disabled={grants.isFetching}
						onClick={() => void grants.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="校园邮箱自动准入；其他邮箱必须逐地址授权并完成邮箱验证。"
				title="账号准入"
			/>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Badge tone={data.environment === "production" ? "warning" : "neutral"}>
					{data.environment}
				</Badge>
				<Badge tone="neutral">当前页 {data.items.length} 条</Badge>
			</div>
			{commandError ? (
				<div className="mb-4">
					<ErrorState error={commandError} title="账号准入操作失败" />
				</div>
			) : null}
			<CreateGrantForm
				disabled={createGrant.isPending}
				environment={data.environment}
				onSubmit={(value) => createGrant.mutate(value)}
			/>
			<div className="mb-4 flex flex-wrap gap-2">
				<Input
					aria-label="按邮箱筛选"
					className="min-h-10 min-w-64 flex-1"
					onChange={(event) => {
						setCursor(undefined);
						setPreviousCursors([]);
						setEmailFilter(event.target.value);
					}}
					placeholder="按邮箱筛选"
					value={emailFilter}
				/>
				<NativeSelect
					aria-label="按授权类型筛选"
					className="min-h-10"
					onChange={(event) => {
						setCursor(undefined);
						setPreviousCursors([]);
						setKindFilter(event.target.value as EmailAccessGrantKind | "");
					}}
					value={kindFilter}
				>
					<option value="">全部类型</option>
					<option value="invitation">正式邀请</option>
					<option value="test">测试授权</option>
				</NativeSelect>
				<NativeSelect
					aria-label="按授权状态筛选"
					className="min-h-10"
					onChange={(event) => {
						setCursor(undefined);
						setPreviousCursors([]);
						setStateFilter(event.target.value as EmailAccessGrantState | "");
					}}
					value={stateFilter}
				>
					<option value="">全部状态</option>
					<option value="pending">待领取</option>
					<option value="active">有效</option>
					<option value="revoked">已撤销</option>
					<option value="expired">已过期</option>
				</NativeSelect>
			</div>
			{data.items.length === 0 ? (
				<p className="rounded-md border border-border bg-background p-6 text-center text-muted-foreground text-sm">
					没有符合条件的授权。
				</p>
			) : (
				<DataTable
					caption="邮箱准入授权"
					data={data.items}
					minWidth="1040px"
					rowKey={(row) => row.id}
					columns={buildColumns({
						command: commandGrant.mutate,
						pending: commandGrant.isPending,
					})}
				/>
			)}
			<div className="mt-4 flex justify-end gap-2">
				<Button
					disabled={previousCursors.length === 0}
					onClick={() => {
						const previous = [...previousCursors];
						setCursor(previous.pop());
						setPreviousCursors(previous);
					}}
					variant="outline"
				>
					上一页
				</Button>
				<Button
					disabled={!data.nextCursor}
					onClick={() => {
						setPreviousCursors((current) => [...current, cursor]);
						setCursor(data.nextCursor ?? undefined);
					}}
					variant="outline"
				>
					下一页
				</Button>
			</div>
		</section>
	);
}

function CreateGrantForm({
	disabled,
	environment,
	onSubmit,
}: {
	disabled: boolean;
	environment: EmailAccessGrant["environment"];
	onSubmit: (input: { accessDays: number; email: string; kind: EmailAccessGrantKind }) => void;
}) {
	const [email, setEmail] = useState("");
	const [kind, setKind] = useState<EmailAccessGrantKind>("invitation");
	const [accessDays, setAccessDays] = useState(7);
	const [confirmed, setConfirmed] = useState(false);
	const requiresConfirmation = environment === "production";
	return (
		<form
			className="mb-4 grid gap-3 border-border border-y bg-background py-4 md:grid-cols-[minmax(16rem,1fr)_10rem_8rem_auto] md:items-end"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit({ accessDays, email: email.trim().toLowerCase(), kind });
			}}
		>
			<label className="grid gap-1 text-foreground text-sm" htmlFor="email-access-address">
				完整邮箱
				<Input
					className="min-h-10"
					id="email-access-address"
					onChange={(event) => setEmail(event.target.value)}
					required
					type="email"
					value={email}
				/>
			</label>
			<label className="grid gap-1 text-foreground text-sm" htmlFor="email-access-kind">
				授权类型
				<NativeSelect
					className="min-h-10"
					id="email-access-kind"
					onChange={(event) => setKind(event.target.value as EmailAccessGrantKind)}
					value={kind}
				>
					<option value="invitation">正式邀请</option>
					{environment === "production" ? null : <option value="test">测试授权</option>}
				</NativeSelect>
			</label>
			{kind === "test" ? (
				<label className="grid gap-1 text-foreground text-sm" htmlFor="email-access-days">
					有效天数
					<Input
						className="min-h-10"
						id="email-access-days"
						max={30}
						min={1}
						onChange={(event) => setAccessDays(Number(event.target.value))}
						type="number"
						value={accessDays}
					/>
				</label>
			) : (
				<div className="hidden md:block" />
			)}
			<Button disabled={disabled || !email || (requiresConfirmation && !confirmed)} type="submit">
				<MailPlus className="size-4" />
				创建并发送
			</Button>
			{requiresConfirmation ? (
				<label
					className="flex items-center gap-2 text-foreground text-sm md:col-span-4"
					htmlFor="email-access-production-confirmation"
				>
					<Checkbox
						checked={confirmed}
						id="email-access-production-confirmation"
						onCheckedChange={(checked) => setConfirmed(checked === true)}
					/>
					确认在 production 创建正式邀请
				</label>
			) : null}
		</form>
	);
}

function buildColumns(input: {
	command: (input: { action: "resend" | "revoke"; grantId: string }) => void;
	pending: boolean;
}) {
	return [
		{
			header: "邮箱",
			cell: (row: EmailAccessGrant) => <span className="break-all font-medium">{row.email}</span>,
			rowHeader: true,
		},
		{ header: "类型", cell: (row: EmailAccessGrant) => kindLabels[row.kind] },
		{
			header: "状态",
			cell: (row: EmailAccessGrant) => (
				<Badge
					tone={
						row.state === "active" ? "success" : row.state === "pending" ? "warning" : "neutral"
					}
				>
					{stateLabels[row.state]}
				</Badge>
			),
		},
		{ header: "领取期限", cell: (row: EmailAccessGrant) => formatTimestamp(row.claimExpiresAt) },
		{
			header: "最近发送",
			cell: (row: EmailAccessGrant) =>
				row.lastInvitationSentAt ? formatTimestamp(row.lastInvitationSentAt) : "尚未被邮件服务接收",
		},
		{
			header: "访问期限",
			cell: (row: EmailAccessGrant) =>
				row.accessExpiresAt ? formatTimestamp(row.accessExpiresAt) : "撤销前有效",
		},
		{
			header: "绑定",
			cell: (row: EmailAccessGrant) =>
				row.userId ? <span className="font-mono text-xs">{row.userId}</span> : "未绑定",
		},
		{
			header: "操作",
			cell: (row: EmailAccessGrant) =>
				row.state === "pending" || row.state === "active" ? (
					<div className="flex gap-2">
						{row.state === "pending" ? (
							<Button
								className="min-h-9 py-1"
								disabled={input.pending}
								onClick={() => input.command({ action: "resend", grantId: row.id })}
								variant="outline"
							>
								<RotateCw className="size-4" />
								重发
							</Button>
						) : null}
						<Button
							className="min-h-9 py-1"
							disabled={input.pending}
							onClick={() => input.command({ action: "revoke", grantId: row.id })}
							variant="outline"
						>
							<ShieldX className="size-4" />
							撤销
						</Button>
					</div>
				) : (
					"-"
				),
		},
	];
}
