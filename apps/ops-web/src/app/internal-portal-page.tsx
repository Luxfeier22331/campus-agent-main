import {
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Ban,
	Check,
	Copy,
	Eye,
	KeyRound,
	Pencil,
	Plus,
	RefreshCw,
	RotateCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import type {
	InternalPortalAutomationToken,
	InternalPortalAutomationTokenMetadata,
	InternalPortalCredential,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import {
	createInternalPortalAutomationToken,
	createInternalPortalCredential,
	deleteInternalPortalCredential,
	fetchInternalPortalAutomationTokens,
	fetchInternalPortalCredentials,
	renameInternalPortalCredential,
	revealInternalPortalAutomationToken,
	revealInternalPortalCredential,
	revokeInternalPortalAutomationToken,
	rotateInternalPortalCredential,
	validateInternalPortalCredential,
} from "./ops-api-client";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { ConfirmAction } from "./ui/alert-dialog";
import { DataTable } from "./ui/data-table";

const CREDENTIALS_QUERY_KEY = ["ops", "internal-portal", "credentials"] as const;
const AUTOMATION_TOKENS_QUERY_KEY = ["ops", "internal-portal", "automation-tokens"] as const;

type CredentialDialog =
	| { kind: "create" }
	| { credential: InternalPortalCredential; kind: "rename" | "reveal" | "rotate" }
	| null;

type AutomationTokenDialog =
	| { kind: "create" }
	| { kind: "reveal"; token: InternalPortalAutomationTokenMetadata }
	| null;

export function InternalPortalPage() {
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<CredentialDialog>(null);
	const [tokenDialog, setTokenDialog] = useState<AutomationTokenDialog>(null);
	const [commandError, setCommandError] = useState<unknown>(null);
	const credentials = useQuery({
		queryFn: ({ signal }) => fetchInternalPortalCredentials({ signal }),
		queryKey: CREDENTIALS_QUERY_KEY,
	});
	const automationTokens = useQuery({
		queryFn: ({ signal }) => fetchInternalPortalAutomationTokens({ signal }),
		queryKey: AUTOMATION_TOKENS_QUERY_KEY,
	});
	const refresh = async () => {
		await queryClient.invalidateQueries({ exact: true, queryKey: CREDENTIALS_QUERY_KEY });
	};
	const refreshAutomationTokens = async () => {
		await queryClient.invalidateQueries({ exact: true, queryKey: AUTOMATION_TOKENS_QUERY_KEY });
	};
	const validate = useMutation({
		mutationFn: validateInternalPortalCredential,
		onError: setCommandError,
		onSuccess: refresh,
	});
	const remove = useMutation({
		mutationFn: deleteInternalPortalCredential,
		onError: setCommandError,
		onSuccess: refresh,
	});
	const revokeToken = useMutation({
		mutationFn: revokeInternalPortalAutomationToken,
		onError: setCommandError,
		onSuccess: refreshAutomationTokens,
	});

	if (credentials.isPending) {
		return (
			<section>
				<PageHeader title="内部门户凭据" />
				<p className="text-muted-foreground text-sm">正在读取凭据...</p>
			</section>
		);
	}
	if (credentials.isError || !credentials.data) {
		return (
			<section>
				<PageHeader title="内部门户凭据" />
				<ErrorState
					error={credentials.error}
					onRetry={() => void credentials.refetch()}
					title="凭据读取失败"
				/>
			</section>
		);
	}

	const rows = credentials.data.credentials;
	const actions = {
		delete: (credential: InternalPortalCredential) => {
			setCommandError(null);
			remove.mutate(credential);
		},
		open: (next: CredentialDialog) => {
			setCommandError(null);
			setDialog(next);
		},
		validate: (credentialId: string) => {
			setCommandError(null);
			validate.mutate(credentialId);
		},
	};
	return (
		<TooltipProvider>
			<section>
				<PageHeader
					actions={
						<div className="flex gap-2">
							<Button
								aria-label="刷新凭据"
								disabled={credentials.isFetching}
								onClick={() => void credentials.refetch()}
								size="icon"
								title="刷新凭据"
								variant="outline"
							>
								<RefreshCw className="size-4" />
							</Button>
							<Button onClick={() => actions.open({ kind: "create" })}>
								<Plus className="size-4" />
								新增凭据
							</Button>
						</div>
					}
					title="内部门户凭据"
				/>
				{commandError ? (
					<div className="mb-5">
						<ErrorState error={commandError} title="凭据操作失败" />
					</div>
				) : null}
				{rows.length === 0 ? (
					<div className="border-border border-y bg-background px-4 py-10 text-center text-muted-foreground text-sm">
						尚无内部门户凭据。
					</div>
				) : (
					<>
						<div className="hidden md:block">
							<DataTable
								busy={validate.isPending || remove.isPending}
								caption="内部门户凭据"
								columns={credentialColumns(actions)}
								data={rows}
								minWidth="920px"
								rowKey={(row) => row.credentialId}
								stickyLastColumn
							/>
						</div>
						<div className="border-border border-y md:hidden">
							{rows.map((credential) => (
								<CredentialMobileRow
									actions={actions}
									credential={credential}
									key={credential.credentialId}
								/>
							))}
						</div>
					</>
				)}
			</section>
			<AutomationTokensSection
				onOpen={(next) => {
					setCommandError(null);
					setTokenDialog(next);
				}}
				onRevoke={(token) => {
					setCommandError(null);
					revokeToken.mutate(token);
				}}
				query={automationTokens}
			/>
			{dialog?.kind === "create" ? (
				<CreateCredentialDialog onClose={() => setDialog(null)} onSaved={refresh} />
			) : null}
			{dialog?.kind === "rename" ? (
				<RenameCredentialDialog
					credential={dialog.credential}
					onClose={() => setDialog(null)}
					onSaved={refresh}
				/>
			) : null}
			{dialog?.kind === "rotate" ? (
				<RotateCredentialDialog
					credential={dialog.credential}
					onClose={() => setDialog(null)}
					onSaved={refresh}
				/>
			) : null}
			{dialog?.kind === "reveal" ? (
				<RevealCredentialDialog credential={dialog.credential} onClose={() => setDialog(null)} />
			) : null}
			{tokenDialog?.kind === "create" ? (
				<CreateAutomationTokenDialog
					onClose={() => setTokenDialog(null)}
					onSaved={refreshAutomationTokens}
				/>
			) : null}
			{tokenDialog?.kind === "reveal" ? (
				<RevealAutomationTokenDialog
					token={tokenDialog.token}
					onClose={() => setTokenDialog(null)}
				/>
			) : null}
		</TooltipProvider>
	);
}

interface AutomationTokenQueryResult {
	data?: {
		endpoint: string;
		tokens: InternalPortalAutomationTokenMetadata[];
	};
	error: unknown;
	isError: boolean;
	isFetching: boolean;
	isPending: boolean;
	refetch: () => Promise<unknown>;
}

function AutomationTokensSection(props: {
	onOpen: (dialog: AutomationTokenDialog) => void;
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => void;
	query: AutomationTokenQueryResult;
}) {
	const [copied, setCopied] = useState(false);
	if (props.query.isPending) {
		return (
			<section className="mt-10">
				<h2 className="font-semibold text-foreground text-lg">开发者自动化访问</h2>
				<p className="mt-2 text-muted-foreground text-sm">正在读取自动化 token...</p>
			</section>
		);
	}
	if (props.query.isError || !props.query.data) {
		return (
			<section className="mt-10">
				<h2 className="font-semibold text-foreground text-lg">开发者自动化访问</h2>
				<div className="mt-3">
					<ErrorState
						error={props.query.error}
						onRetry={() => void props.query.refetch()}
						title="自动化 token 读取失败"
					/>
				</div>
			</section>
		);
	}

	const { endpoint, tokens } = props.query.data;
	return (
		<section className="mt-10">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="font-semibold text-foreground text-lg">开发者自动化访问</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						开发者程序使用下方端点和 Bearer token 创建、更新或删除凭据。
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						aria-label="刷新自动化 token"
						disabled={props.query.isFetching}
						onClick={() => void props.query.refetch()}
						size="icon"
						title="刷新自动化 token"
						variant="outline"
					>
						<RefreshCw className="size-4" />
					</Button>
					<Button onClick={() => props.onOpen({ kind: "create" })}>
						<KeyRound className="size-4" />
						生成 token
					</Button>
				</div>
			</div>
			<div className="mt-4 flex max-w-3xl items-center gap-2">
				<Input aria-label="自动化接口地址" readOnly value={endpoint} />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							aria-label="复制自动化接口地址"
							onClick={() => {
								void navigator.clipboard.writeText(endpoint).then(() => setCopied(true));
							}}
							size="icon"
							variant="outline"
						>
							{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{copied ? "已复制" : "复制端点"}</TooltipContent>
				</Tooltip>
			</div>
			{tokens.length === 0 ? (
				<div className="mt-4 border-border border-y bg-background px-4 py-8 text-center text-muted-foreground text-sm">
					尚未生成自动化 token。
				</div>
			) : (
				<div className="mt-4 hidden md:block">
					<DataTable
						busy={props.query.isFetching}
						caption="开发者自动化 token"
						columns={automationTokenColumns(props)}
						data={tokens}
						minWidth="760px"
						rowKey={(row) => row.tokenId}
						stickyLastColumn
					/>
				</div>
			)}
			{tokens.length > 0 ? (
				<div className="mt-4 border-border border-y md:hidden">
					{tokens.map((token) => (
						<AutomationTokenMobileRow
							key={token.tokenId}
							onOpen={props.onOpen}
							onRevoke={props.onRevoke}
							token={token}
						/>
					))}
				</div>
			) : null}
		</section>
	);
}

function automationTokenColumns(actions: {
	onOpen: (dialog: AutomationTokenDialog) => void;
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => void;
}) {
	return [
		{
			cell: (row: InternalPortalAutomationTokenMetadata) => (
				<div className="grid gap-1">
					<span>{row.name}</span>
					<span className="font-mono text-muted-foreground text-xs">{row.tokenId}</span>
				</div>
			),
			header: "名称",
			rowHeader: true,
		},
		{
			cell: (row: InternalPortalAutomationTokenMetadata) => (
				<AutomationTokenStatus revokedAt={row.revokedAt} />
			),
			header: "状态",
		},
		{
			cell: (row: InternalPortalAutomationTokenMetadata) => formatTimestamp(row.createdAt),
			header: "创建时间",
		},
		{
			cell: (row: InternalPortalAutomationTokenMetadata) => (
				<AutomationTokenActions onOpen={actions.onOpen} onRevoke={actions.onRevoke} token={row} />
			),
			cellClassName: "w-[10rem]",
			header: "操作",
			stickyRight: true,
		},
	];
}

function AutomationTokenMobileRow(props: {
	onOpen: (dialog: AutomationTokenDialog) => void;
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => void;
	token: InternalPortalAutomationTokenMetadata;
}) {
	return (
		<div className="grid gap-3 border-border border-b px-1 py-4 last:border-b-0">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="break-words font-medium text-foreground">{props.token.name}</p>
					<p className="truncate font-mono text-muted-foreground text-xs">{props.token.tokenId}</p>
				</div>
				<AutomationTokenStatus revokedAt={props.token.revokedAt} />
			</div>
			<p className="text-muted-foreground text-xs">
				创建于 {formatTimestamp(props.token.createdAt)}
			</p>
			<AutomationTokenActions onOpen={props.onOpen} onRevoke={props.onRevoke} token={props.token} />
		</div>
	);
}

function AutomationTokenStatus({ revokedAt }: { revokedAt: string | null }) {
	return revokedAt ? <Badge tone="neutral">已撤销</Badge> : <Badge tone="success">可用</Badge>;
}

function AutomationTokenActions(props: {
	onOpen: (dialog: AutomationTokenDialog) => void;
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => void;
	token: InternalPortalAutomationTokenMetadata;
}) {
	return (
		<div className="flex justify-end gap-1">
			<IconAction
				icon={<Eye />}
				label="显示 token"
				onClick={() => props.onOpen({ kind: "reveal", token: props.token })}
			/>
			{props.token.revokedAt ? null : (
				<ConfirmAction
					confirmLabel="撤销"
					description={`撤销“${props.token.name}”后，使用该 token 的程序将无法继续访问。`}
					onConfirm={() => props.onRevoke(props.token)}
					title="撤销自动化 token"
					trigger={
						<span>
							<IconAction icon={<Ban />} label="撤销 token" variant="destructive" />
						</span>
					}
				/>
			)}
		</div>
	);
}

function CreateAutomationTokenDialog(props: {
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [name, setName] = useState("");
	const [created, setCreated] = useState<InternalPortalAutomationToken | null>(null);
	const [copied, setCopied] = useState(false);
	const create = useMutation({
		mutationFn: async () => {
			const token = await createInternalPortalAutomationToken(name.trim());
			setCreated(token);
			await props.onSaved();
		},
	});
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{created ? "自动化 token 已生成" : "生成自动化 token"}</DialogTitle>
					<DialogDescription>
						{created
							? "请复制 token 并交给需要调用凭据接口的开发程序。"
							: "为这组开发程序设置一个可识别的名称。"}
					</DialogDescription>
				</DialogHeader>
				{created ? (
					<div className="grid gap-3">
						<Input aria-label="自动化 token 明文" readOnly value={created.tokenValue} />
						<Button
							onClick={() => {
								void navigator.clipboard.writeText(created.tokenValue).then(() => setCopied(true));
							}}
							variant="outline"
						>
							{copied ? <Check /> : <Copy />}
							{copied ? "已复制" : "复制 token"}
						</Button>
					</div>
				) : (
					<form
						className="grid gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							create.mutate();
						}}
					>
						<label className="grid gap-1 text-sm" htmlFor="internal-portal-automation-token-name">
							<span className="font-medium">名称</span>
							<Input
								autoFocus
								id="internal-portal-automation-token-name"
								maxLength={80}
								onChange={(event) => setName(event.target.value)}
								required
								value={name}
							/>
						</label>
						{create.error ? <InlineError error={create.error} title="token 生成失败" /> : null}
						<DialogFooter>
							<Button onClick={props.onClose} variant="outline">
								取消
							</Button>
							<Button disabled={create.isPending || !name.trim()} type="submit">
								生成
							</Button>
						</DialogFooter>
					</form>
				)}
				{created ? (
					<DialogFooter>
						<Button onClick={props.onClose} variant="outline">
							关闭
						</Button>
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RevealAutomationTokenDialog(props: {
	onClose: () => void;
	token: InternalPortalAutomationTokenMetadata;
}) {
	const [revealed, setRevealed] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const reveal = useMutation({
		mutationFn: async () => {
			const token = await revealInternalPortalAutomationToken(props.token.tokenId);
			setRevealed(token.tokenValue);
		},
	});
	const close = () => {
		setRevealed(null);
		setCopied(false);
		reveal.reset();
		props.onClose();
	};
	return (
		<Dialog onOpenChange={(open) => !open && close()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>自动化 token 明文</DialogTitle>
					<DialogDescription>{props.token.name}</DialogDescription>
				</DialogHeader>
				{revealed ? (
					<div className="grid gap-3">
						<Input aria-label="自动化 token 明文" readOnly value={revealed} />
						<Button
							onClick={() => {
								void navigator.clipboard.writeText(revealed).then(() => setCopied(true));
							}}
							variant="outline"
						>
							{copied ? <Check /> : <Copy />}
							{copied ? "已复制" : "复制 token"}
						</Button>
					</div>
				) : (
					<Button disabled={reveal.isPending} onClick={() => reveal.mutate()}>
						<Eye />
						{reveal.isPending ? "读取中" : "显示 token"}
					</Button>
				)}
				{reveal.error ? <InlineError error={reveal.error} title="token 读取失败" /> : null}
				<DialogFooter>
					<Button onClick={close} variant="outline">
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function credentialColumns(actions: CredentialActions) {
	return [
		{
			cell: (row: InternalPortalCredential) => (
				<div className="grid gap-1">
					<span>{row.name}</span>
					<span className="font-mono text-muted-foreground text-xs">{row.credentialId}</span>
				</div>
			),
			header: "名称",
			rowHeader: true,
		},
		{
			cell: (row: InternalPortalCredential) => <OutcomeBadge outcome={row.lastOutcome} />,
			header: "最近结果",
		},
		{
			cell: (row: InternalPortalCredential) => formatTimestamp(row.lastAttemptAt),
			header: "最近尝试",
		},
		{
			cell: (row: InternalPortalCredential) => formatTimestamp(row.lastSuccessfulAt),
			header: "最近成功",
		},
		{
			cell: (row: InternalPortalCredential) => (
				<CredentialActions actions={actions} credential={row} />
			),
			cellClassName: "w-[16rem]",
			header: "操作",
			stickyRight: true,
		},
	];
}

interface CredentialActions {
	delete: (credential: InternalPortalCredential) => void;
	open: (dialog: Exclude<CredentialDialog, null>) => void;
	validate: (credentialId: string) => void;
}

function CredentialActions(props: {
	actions: CredentialActions;
	credential: InternalPortalCredential;
}) {
	return (
		<div className="flex flex-wrap justify-end gap-1">
			<IconAction
				icon={<ShieldCheck />}
				label="检查凭据"
				onClick={() => props.actions.validate(props.credential.credentialId)}
			/>
			<IconAction
				icon={<Eye />}
				label="显示明文"
				onClick={() => props.actions.open({ credential: props.credential, kind: "reveal" })}
			/>
			<IconAction
				icon={<Pencil />}
				label="重命名"
				onClick={() => props.actions.open({ credential: props.credential, kind: "rename" })}
			/>
			<IconAction
				icon={<RotateCw />}
				label="轮换凭据"
				onClick={() => props.actions.open({ credential: props.credential, kind: "rotate" })}
			/>
			<ConfirmAction
				confirmLabel="删除"
				description={`将删除“${props.credential.name}”。`}
				onConfirm={() => props.actions.delete(props.credential)}
				title="删除内部门户凭据"
				trigger={
					<span>
						<IconAction icon={<Trash2 />} label="删除凭据" variant="destructive" />
					</span>
				}
			/>
		</div>
	);
}

function IconAction(props: {
	icon: React.ReactNode;
	label: string;
	onClick?: () => void;
	variant?: "destructive" | "ghost";
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					aria-label={props.label}
					onClick={props.onClick}
					size="icon"
					variant={props.variant ?? "ghost"}
				>
					{props.icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{props.label}</TooltipContent>
		</Tooltip>
	);
}

function CredentialMobileRow(props: {
	actions: CredentialActions;
	credential: InternalPortalCredential;
}) {
	return (
		<div className="grid gap-3 border-border border-b px-1 py-4 last:border-b-0">
			<div className="flex min-w-0 items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="break-words font-medium text-foreground">{props.credential.name}</p>
					<p className="truncate font-mono text-muted-foreground text-xs">
						{props.credential.credentialId}
					</p>
				</div>
				<OutcomeBadge outcome={props.credential.lastOutcome} />
			</div>
			<dl className="grid grid-cols-2 gap-3 text-xs">
				<div>
					<dt className="text-muted-foreground">最近尝试</dt>
					<dd className="mt-1 text-foreground">
						{formatTimestamp(props.credential.lastAttemptAt)}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">最近成功</dt>
					<dd className="mt-1 text-foreground">
						{formatTimestamp(props.credential.lastSuccessfulAt)}
					</dd>
				</div>
			</dl>
			<CredentialActions actions={props.actions} credential={props.credential} />
		</div>
	);
}

function OutcomeBadge({ outcome }: { outcome: InternalPortalCredential["lastOutcome"] }) {
	if (outcome === "valid") {
		return <Badge tone="success">上次检查通过</Badge>;
	}
	if (outcome === "credential_rejected") {
		return <Badge tone="danger">已暂停，等待轮换</Badge>;
	}
	if (outcome === "check_failed") {
		return <Badge tone="warning">上次检查失败</Badge>;
	}
	return <Badge tone="neutral">未检查</Badge>;
}

function CreateCredentialDialog(props: { onClose: () => void; onSaved: () => Promise<unknown> }) {
	const [name, setName] = useState("");
	const [ssoTgc, setSsoTgc] = useState("");
	const create = useMutation({
		mutationFn: () => createInternalPortalCredential({ name: name.trim(), ssoTgc }),
		onSuccess: async () => {
			await props.onSaved();
			props.onClose();
		},
	});
	return (
		<CredentialFormDialog
			error={create.error}
			name={name}
			onClose={props.onClose}
			onNameChange={setName}
			onSubmit={() => create.mutate()}
			onTgcChange={setSsoTgc}
			pending={create.isPending}
			ssoTgc={ssoTgc}
			submitLabel="新增"
			title="新增内部门户凭据"
		/>
	);
}

function RenameCredentialDialog(props: {
	credential: InternalPortalCredential;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [name, setName] = useState(props.credential.name);
	const rename = useMutation({
		mutationFn: () => renameInternalPortalCredential(props.credential, name.trim()),
		onSuccess: async () => {
			await props.onSaved();
			props.onClose();
		},
	});
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>重命名凭据</DialogTitle>
					<DialogDescription>{props.credential.credentialId}</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						rename.mutate();
					}}
				>
					<label className="grid gap-1 text-sm" htmlFor="internal-portal-rename">
						<span className="font-medium">名称</span>
						<Input
							autoFocus
							id="internal-portal-rename"
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
							required
							value={name}
						/>
					</label>
					{rename.error ? <InlineError error={rename.error} title="重命名失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="outline">
							取消
						</Button>
						<Button disabled={rename.isPending || !name.trim()} type="submit">
							保存
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RotateCredentialDialog(props: {
	credential: InternalPortalCredential;
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [ssoTgc, setSsoTgc] = useState("");
	const rotate = useMutation({
		mutationFn: () => rotateInternalPortalCredential(props.credential, ssoTgc),
		onSuccess: async () => {
			setSsoTgc("");
			await props.onSaved();
			props.onClose();
		},
	});
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>轮换凭据</DialogTitle>
					<DialogDescription>{props.credential.name}</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						rotate.mutate();
					}}
				>
					<TgcInput onChange={setSsoTgc} value={ssoTgc} />
					{rotate.error ? <InlineError error={rotate.error} title="轮换失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="outline">
							取消
						</Button>
						<Button disabled={rotate.isPending || !ssoTgc.trim()} type="submit">
							轮换
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function RevealCredentialDialog(props: {
	credential: InternalPortalCredential;
	onClose: () => void;
}) {
	const [revealed, setRevealed] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const reveal = useMutation({
		mutationFn: async () => {
			const result = await revealInternalPortalCredential(props.credential.credentialId);
			setRevealed(result.ssoTgc);
		},
	});
	const close = () => {
		setRevealed(null);
		setCopied(false);
		reveal.reset();
		props.onClose();
	};
	return (
		<Dialog onOpenChange={(open) => !open && close()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>凭据明文</DialogTitle>
					<DialogDescription>{props.credential.name}</DialogDescription>
				</DialogHeader>
				{revealed ? (
					<div className="grid gap-3">
						<Input aria-label="SSO_TGC 明文" readOnly value={revealed} />
						<Button
							onClick={() => {
								void navigator.clipboard.writeText(revealed).then(() => setCopied(true));
							}}
							variant="outline"
						>
							{copied ? <Check /> : <Copy />}
							{copied ? "已复制" : "复制"}
						</Button>
					</div>
				) : (
					<Button disabled={reveal.isPending} onClick={() => reveal.mutate()}>
						<Eye />
						{reveal.isPending ? "读取中" : "显示明文"}
					</Button>
				)}
				{reveal.error ? <InlineError error={reveal.error} title="明文读取失败" /> : null}
				<DialogFooter>
					<Button onClick={close} variant="outline">
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function CredentialFormDialog(props: {
	error: unknown;
	name: string;
	onClose: () => void;
	onNameChange: (value: string) => void;
	onSubmit: () => void;
	onTgcChange: (value: string) => void;
	pending: boolean;
	ssoTgc: string;
	submitLabel: string;
	title: string;
}) {
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{props.title}</DialogTitle>
					<DialogDescription>SSO_TGC 或 Cookie</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						props.onSubmit();
					}}
				>
					<label className="grid gap-1 text-sm" htmlFor="internal-portal-create-name">
						<span className="font-medium">名称</span>
						<Input
							autoFocus
							id="internal-portal-create-name"
							maxLength={80}
							onChange={(event) => props.onNameChange(event.target.value)}
							required
							value={props.name}
						/>
					</label>
					<TgcInput onChange={props.onTgcChange} value={props.ssoTgc} />
					{props.error ? <InlineError error={props.error} title="凭据新增失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="outline">
							取消
						</Button>
						<Button
							disabled={props.pending || !props.name.trim() || !props.ssoTgc.trim()}
							type="submit"
						>
							{props.submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function TgcInput(props: { onChange: (value: string) => void; value: string }) {
	return (
		<label className="grid gap-1 text-sm" htmlFor="internal-portal-sso-tgc">
			<span className="font-medium">SSO_TGC 或 Cookie</span>
			<Input
				autoComplete="off"
				id="internal-portal-sso-tgc"
				maxLength={16 * 1024}
				onChange={(event) => props.onChange(event.target.value)}
				required
				spellCheck={false}
				type="password"
				value={props.value}
			/>
		</label>
	);
}
