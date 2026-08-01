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

const environmentLabels: Record<EmailAccessGrant["environment"], string> = {
	development: "开发环境",
	production: "生产环境",
	staging: "预发布环境",
	test: "测试环境",
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
			{commandError ? (
				<div className="mb-6">
					<ErrorState error={commandError} title="账号准入操作失败" />
				</div>
			) : null}
			<section aria-labelledby="create-email-access-heading" className="mb-8">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 className="font-semibold text-foreground text-lg" id="create-email-access-heading">
						创建授权
					</h2>
					<Badge tone={data.environment === "production" ? "warning" : "neutral"}>
						{environmentLabels[data.environment]}
					</Badge>
				</div>
				<CreateGrantForm
					disabled={createGrant.isPending}
					environment={data.environment}
					onSubmit={(value) => createGrant.mutate(value)}
				/>
			</section>
			<section aria-labelledby="email-access-records-heading">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 className="font-semibold text-foreground text-lg" id="email-access-records-heading">
						授权记录
					</h2>
					<span className="text-muted-foreground text-sm">当前页 {data.items.length} 条</span>
				</div>
				<div className="mb-4 grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_10rem_10rem]">
					<Input
						aria-label="按邮箱筛选"
						className="min-h-10 min-w-0"
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
						className="min-h-10 min-w-0"
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
						className="min-h-10 min-w-0"
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
					<p className="border-border border-y bg-background p-6 text-center text-muted-foreground text-sm">
						没有符合条件的授权。
					</p>
				) : (
					<>
						<div className="hidden md:block">
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
						</div>
						<GrantMobileList
							command={commandGrant.mutate}
							grants={data.items}
							pending={commandGrant.isPending}
						/>
					</>
				)}
			</section>
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
			className="grid gap-3 border-border border-y bg-background py-4 md:grid-cols-[minmax(16rem,1fr)_10rem_8rem_auto] md:items-end"
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
			<Button
				className="w-full md:w-auto"
				disabled={disabled || !email || (requiresConfirmation && !confirmed)}
				type="submit"
			>
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

function GrantMobileList({
	command,
	grants,
	pending,
}: {
	command: (input: { action: "resend" | "revoke"; grantId: string }) => void;
	grants: EmailAccessGrant[];
	pending: boolean;
}) {
	return (
		<div
			className="divide-y divide-border border-border border-y bg-background md:hidden"
			data-testid="email-access-mobile-list"
		>
			{grants.map((grant) => (
				<article className="grid min-w-0 gap-4 py-4" key={grant.id}>
					<header className="flex min-w-0 items-start justify-between gap-3">
						<h3 className="min-w-0 break-all font-semibold text-foreground text-sm">
							{grant.email}
						</h3>
						<GrantStateBadge state={grant.state} />
					</header>
					<dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
						<GrantFact label="类型" value={kindLabels[grant.kind]} />
						<GrantFact label="领取期限" value={formatTimestamp(grant.claimExpiresAt)} />
						<GrantFact
							label="最近发送"
							value={
								grant.lastInvitationSentAt
									? formatTimestamp(grant.lastInvitationSentAt)
									: "尚未被邮件服务接收"
							}
						/>
						<GrantFact
							label="访问期限"
							value={grant.accessExpiresAt ? formatTimestamp(grant.accessExpiresAt) : "撤销前有效"}
						/>
						<GrantFact className="col-span-2" label="绑定" value={grant.userId ?? "未绑定"} />
					</dl>
					<GrantActions command={command} grant={grant} pending={pending} />
				</article>
			))}
		</div>
	);
}

function GrantFact({
	className,
	label,
	value,
}: {
	className?: string;
	label: string;
	value: string;
}) {
	return (
		<div className={className}>
			<dt className="font-medium text-muted-foreground text-xs">{label}</dt>
			<dd className="mt-1 min-w-0 break-words text-foreground">{value}</dd>
		</div>
	);
}

function GrantStateBadge({ state }: { state: EmailAccessGrantState }) {
	return (
		<Badge tone={state === "active" ? "success" : state === "pending" ? "warning" : "neutral"}>
			{stateLabels[state]}
		</Badge>
	);
}

function GrantActions({
	command,
	grant,
	pending,
}: {
	command: (input: { action: "resend" | "revoke"; grantId: string }) => void;
	grant: EmailAccessGrant;
	pending: boolean;
}) {
	if (grant.state !== "pending" && grant.state !== "active") {
		return null;
	}
	return (
		<div className="flex flex-wrap gap-2">
			{grant.state === "pending" ? (
				<Button
					className="min-h-9 py-1"
					disabled={pending}
					onClick={() => command({ action: "resend", grantId: grant.id })}
					variant="outline"
				>
					<RotateCw className="size-4" />
					重发
				</Button>
			) : null}
			<Button
				className="min-h-9 py-1"
				disabled={pending}
				onClick={() => command({ action: "revoke", grantId: grant.id })}
				variant="outline"
			>
				<ShieldX className="size-4" />
				撤销
			</Button>
		</div>
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
			cell: (row: EmailAccessGrant) => <GrantStateBadge state={row.state} />,
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
					<GrantActions command={input.command} grant={row} pending={input.pending} />
				) : (
					"-"
				),
		},
	];
}
