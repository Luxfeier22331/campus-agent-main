import {
	ActionGroup,
	Badge,
	Button,
	Checkbox,
	ConfirmDialog,
	Field,
	Input,
	Label,
	StateMessage,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	EmailAccessGrant,
	EmailAccessGrantKind,
	EmailAccessGrantState,
} from "campus-contracts/email-access";
import { MailPlus, RefreshCw, RotateCw, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { formatTimestamp } from "./format";
import {
	commandEmailAccessGrant,
	createEmailAccessGrant,
	fetchEmailAccessGrants,
} from "./ops-api/email-access";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";
import { FilterSelect } from "./ui/filter-select";
import { useConfirmCommand } from "./use-confirm-command";

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
	const confirmCommand = useConfirmCommand();
	const [emailFilter, setEmailFilter] = useState("");
	const [draft, setDraft] = useState({
		email: "",
		kind: "" as EmailAccessGrantKind | "",
		state: "" as EmailAccessGrantState | "",
	});
	const [environment, setEnvironment] = useState<EmailAccessGrant["environment"]>();
	const [kindFilter, setKindFilter] = useState<EmailAccessGrantKind | "">("");
	const [stateFilter, setStateFilter] = useState<EmailAccessGrantState | "">("");
	const [cursor, setCursor] = useState<string | undefined>();
	const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
	const [commandError, setCommandError] = useState<unknown>(null);
	const [rowErrors, setRowErrors] = useState<Record<string, unknown>>({});
	const grants = useQuery({
		queryFn: ({ signal }) =>
			fetchEmailAccessGrants(
				{
					...(cursor ? { cursor } : {}),
					...(emailFilter.trim() ? { email: emailFilter.trim() } : {}),
					...(kindFilter ? { kind: kindFilter } : {}),
					...(stateFilter ? { state: stateFilter } : {}),
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
		onSuccess: refresh,
	});
	const runGrantCommand = async (input: { action: "resend" | "revoke"; grantId: string }) => {
		setRowErrors((current) => ({ ...current, [input.grantId]: undefined }));
		try {
			await commandGrant.mutateAsync(input);
		} catch (error) {
			setRowErrors((current) => ({ ...current, [input.grantId]: error }));
			throw error;
		}
	};

	useEffect(() => {
		if (grants.data) {
			setEnvironment(grants.data.environment);
		}
	}, [grants.data]);

	const data = grants.data;
	return (
		<section>
			<PageHeader
				actions={
					<Button
						disabled={grants.isFetching}
						onClick={() => void grants.refetch()}
						variant="ghost"
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
			{environment ? (
				<section aria-labelledby="create-email-access-heading" className="ops-section mb-5">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<h2 className="font-semibold text-foreground text-lg" id="create-email-access-heading">
							创建授权
						</h2>
						<Badge tone={environment === "production" ? "warning" : "neutral"}>
							{environmentLabels[environment]}
						</Badge>
					</div>
					<CreateGrantForm
						disabled={createGrant.isPending}
						environment={environment}
						onSubmit={(value) => createGrant.mutate(value)}
					/>
				</section>
			) : null}
			<section aria-labelledby="email-access-records-heading">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					<h2 className="font-semibold text-foreground text-lg" id="email-access-records-heading">
						授权记录
					</h2>
					<span className="text-muted-foreground text-sm">当前页 {data?.items.length ?? 0} 条</span>
				</div>
				<form
					className="ops-filter-bar mb-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_10rem_10rem_auto]"
					onSubmit={(event) => {
						event.preventDefault();
						setEmailFilter(draft.email.trim());
						setKindFilter(draft.kind);
						setStateFilter(draft.state);
						setCursor(undefined);
						setPreviousCursors([]);
					}}
				>
					<Field label="按邮箱筛选">
						<Input
							aria-label="按邮箱筛选"
							className="min-h-11 min-w-0"
							name="email-access-filter-email"
							onChange={(event) => setDraft({ ...draft, email: event.target.value })}
							placeholder="按邮箱筛选"
							value={draft.email}
						/>
					</Field>
					<Field label="按授权类型筛选">
						<FilterSelect
							aria-label="按授权类型筛选"
							className="min-h-11 min-w-0"
							name="email-access-filter-kind"
							onValueChange={(nextValue) =>
								setDraft({ ...draft, kind: nextValue as EmailAccessGrantKind | "" })
							}
							value={draft.kind}
							options={[
								{ value: "", label: "全部类型" },
								{ value: "invitation", label: "正式邀请" },
								{ value: "test", label: "测试授权" },
							]}
						/>
					</Field>
					<Field label="按授权状态筛选">
						<FilterSelect
							aria-label="按授权状态筛选"
							className="min-h-11 min-w-0"
							name="email-access-filter-state"
							onValueChange={(nextValue) =>
								setDraft({ ...draft, state: nextValue as EmailAccessGrantState | "" })
							}
							value={draft.state}
							options={[
								{ value: "", label: "全部状态" },
								{ value: "pending", label: "待领取" },
								{ value: "active", label: "有效" },
								{ value: "revoked", label: "已撤销" },
								{ value: "expired", label: "已过期" },
							]}
						/>
					</Field>
					<ActionGroup>
						<Button type="submit">查询</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={() => {
								setDraft({ email: "", kind: "", state: "" });
								setEmailFilter("");
								setKindFilter("");
								setStateFilter("");
								setCursor(undefined);
								setPreviousCursors([]);
							}}
						>
							清除筛选
						</Button>
					</ActionGroup>
				</form>
				{grants.isPending ? (
					<StateMessage layout="inline" role="status" description="正在读取授权..." />
				) : null}
				{grants.error ? (
					<ErrorState
						error={grants.error}
						title={data ? "授权刷新失败，仍显示上次结果" : "账号准入读取失败"}
						onRetry={() => void grants.refetch()}
					/>
				) : null}
				{data ? (
					data.items.length === 0 ? (
						<StateMessage description="没有符合条件的授权。" />
					) : (
						<>
							<div className="hidden md:block">
								<DataTable
									caption="邮箱准入授权"
									data={data.items}
									minWidth="1040px"
									rowKey={(row) => row.id}
									columns={buildColumns({
										command: runGrantCommand,
										confirmCommand,
										rowErrors,
										pending: commandGrant.isPending,
									})}
								/>
							</div>
							<GrantMobileList
								command={runGrantCommand}
								confirmCommand={confirmCommand}
								grants={data.items}
								rowErrors={rowErrors}
								pending={commandGrant.isPending}
							/>
						</>
					)
				) : null}
			</section>
			<ActionGroup className="mt-4 justify-end">
				<Button
					disabled={grants.isFetching || previousCursors.length === 0}
					onClick={() => {
						const previous = [...previousCursors];
						setCursor(previous.pop());
						setPreviousCursors(previous);
					}}
					variant="ghost"
				>
					上一页
				</Button>
				<Button
					disabled={grants.isFetching || !data?.nextCursor}
					onClick={() => {
						setPreviousCursors((current) => [...current, cursor]);
						setCursor(data?.nextCursor ?? undefined);
					}}
					variant="ghost"
				>
					下一页
				</Button>
			</ActionGroup>
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
			className="grid gap-3 border-border border-y bg-background py-4 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_10rem_8rem_auto] xl:items-end"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit({ accessDays, email: email.trim().toLowerCase(), kind });
			}}
		>
			<Field label="完整邮箱">
				<Input
					className="min-h-11"
					id="email-access-address"
					onChange={(event) => setEmail(event.target.value)}
					required
					type="email"
					value={email}
				/>
			</Field>
			<Field label="授权类型">
				<FilterSelect
					className="min-h-11"
					id="email-access-kind"
					onValueChange={(nextValue) => setKind(nextValue as EmailAccessGrantKind)}
					value={kind}
					options={[
						{ value: "invitation", label: "正式邀请" },
						...(environment === "production" ? [] : [{ value: "test", label: "测试授权" }]),
					]}
				/>
			</Field>
			{kind === "test" ? (
				<Field label="有效天数">
					<Input
						className="min-h-11"
						id="email-access-days"
						max={30}
						min={1}
						onChange={(event) => setAccessDays(Number(event.target.value))}
						type="number"
						value={accessDays}
					/>
				</Field>
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
				<Label
					className="flex min-h-11 cursor-pointer items-center gap-2 text-foreground text-sm md:col-span-4"
					htmlFor="email-access-production-confirmation"
				>
					<Checkbox
						checked={confirmed}
						id="email-access-production-confirmation"
						onCheckedChange={(checked) => setConfirmed(checked === true)}
					/>
					确认在 production 创建正式邀请
				</Label>
			) : null}
		</form>
	);
}

function GrantMobileList({
	command,
	confirmCommand,
	grants,
	pending,
	rowErrors,
}: {
	command: (input: { action: "resend" | "revoke"; grantId: string }) => Promise<unknown>;
	confirmCommand: ReturnType<typeof useConfirmCommand>;
	grants: EmailAccessGrant[];
	pending: boolean;
	rowErrors: Record<string, unknown>;
}) {
	return (
		<div
			className="divide-y divide-border rounded-[var(--radius-lg)] border border-border bg-background px-3 md:hidden"
			data-testid="email-access-mobile-list"
		>
			{grants.map((grant) => (
				<article className="grid min-w-0 gap-3 py-3" key={grant.id}>
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
					<GrantActions
						command={command}
						confirmCommand={confirmCommand}
						grant={grant}
						mode="mobile"
						pending={pending}
						rowError={rowErrors[grant.id]}
					/>
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
	confirmCommand,
	grant,
	mode,
	pending,
	rowError,
}: {
	command: (input: { action: "resend" | "revoke"; grantId: string }) => Promise<unknown>;
	confirmCommand: ReturnType<typeof useConfirmCommand>;
	grant: EmailAccessGrant;
	mode: "desktop" | "mobile";
	pending: boolean;
	rowError?: unknown;
}) {
	if (grant.state !== "pending" && grant.state !== "active") {
		return null;
	}
	return (
		<div className="grid gap-2">
			<ActionGroup>
				{grant.state === "pending" ? (
					<Button
						size="sm"
						disabled={pending}
						onClick={() =>
							void command({ action: "resend", grantId: grant.id }).catch(() => undefined)
						}
						variant="ghost"
					>
						<RotateCw className="size-4" />
						重发
					</Button>
				) : null}
				<ConfirmDialog
					confirmLabel="撤销"
					confirmVariant="destructive"
					description="撤销后该授权不能继续领取或访问。"
					{...confirmCommand(`${grant.id}-${mode}-revoke`, () =>
						command({ action: "revoke", grantId: grant.id }),
					)}
					title={`撤销 ${grant.email} 的授权？`}
					trigger={
						<Button size="sm" disabled={pending} variant="ghost">
							<ShieldX className="size-4" />
							撤销
						</Button>
					}
				/>
			</ActionGroup>
			{rowError ? <InlineError error={rowError} title="该授权操作失败" /> : null}
		</div>
	);
}

function buildColumns(input: {
	command: (input: { action: "resend" | "revoke"; grantId: string }) => Promise<unknown>;
	confirmCommand: ReturnType<typeof useConfirmCommand>;
	pending: boolean;
	rowErrors: Record<string, unknown>;
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
					<GrantActions
						command={input.command}
						confirmCommand={input.confirmCommand}
						grant={row}
						mode="desktop"
						pending={input.pending}
						rowError={input.rowErrors[row.id]}
					/>
				) : (
					"-"
				),
		},
	];
}
