import {
	ActionGroup,
	Badge,
	Button,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
	StateMessage,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Check, Copy, Eye, KeyRound, RefreshCw } from "lucide-react";
import { useState } from "react";
import type {
	InternalPortalAutomationToken,
	InternalPortalAutomationTokenMetadata,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { InternalPortalIconAction as IconAction } from "./internal-portal-icon-action";
import {
	createInternalPortalAutomationToken,
	fetchInternalPortalAutomationTokens,
	revealInternalPortalAutomationToken,
	revokeInternalPortalAutomationToken,
} from "./ops-api/automation";
import { ErrorState, InlineError } from "./ops-display";
import { DataTable } from "./ui/data-table";
import { useConfirmCommand } from "./use-confirm-command";

const AUTOMATION_TOKENS_QUERY_KEY = ["ops", "internal-portal", "automation-tokens"] as const;

type AutomationTokenDialog =
	| { kind: "create" }
	| { kind: "reveal"; token: InternalPortalAutomationTokenMetadata }
	| null;

export function InternalPortalAutomationSection() {
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<AutomationTokenDialog>(null);
	const [commandError, setCommandError] = useState<unknown>(null);
	const query = useQuery({
		queryFn: ({ signal }) => fetchInternalPortalAutomationTokens({ signal }),
		queryKey: AUTOMATION_TOKENS_QUERY_KEY,
	});
	const refresh = async () => {
		await queryClient.invalidateQueries({
			exact: true,
			queryKey: AUTOMATION_TOKENS_QUERY_KEY,
		});
	};
	const revoke = useMutation({
		mutationFn: revokeInternalPortalAutomationToken,
		onError: setCommandError,
		onSuccess: refresh,
	});

	return (
		<>
			{commandError ? (
				<div className="mt-10">
					<ErrorState error={commandError} title="自动化 token 操作失败" />
				</div>
			) : null}
			<AutomationTokensSection
				onOpen={(next) => {
					setCommandError(null);
					setDialog(next);
				}}
				onRevoke={(token) => {
					setCommandError(null);
					return revoke.mutateAsync(token);
				}}
				query={query}
			/>
			{dialog?.kind === "create" ? (
				<CreateAutomationTokenDialog onClose={() => setDialog(null)} onSaved={refresh} />
			) : null}
			{dialog?.kind === "reveal" ? (
				<RevealAutomationTokenDialog token={dialog.token} onClose={() => setDialog(null)} />
			) : null}
		</>
	);
}

interface AutomationTokenQueryResult {
	data?:
		| {
				endpoint: string;
				tokens: InternalPortalAutomationTokenMetadata[];
		  }
		| undefined;
	error: unknown;
	isError: boolean;
	isFetching: boolean;
	isPending: boolean;
	refetch: () => Promise<unknown>;
}

function AutomationTokensSection(props: {
	onOpen: (dialog: AutomationTokenDialog) => void;
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => Promise<unknown>;
	query: AutomationTokenQueryResult;
}) {
	const [copied, setCopied] = useState(false);
	if (props.query.isPending) {
		return (
			<section className="ops-section mt-6 min-w-0 scroll-mt-24" id="portal-automation">
				<h2 className="font-semibold text-foreground text-lg">开发者自动化访问</h2>
				<StateMessage layout="inline" description="正在读取自动化 token..." />
			</section>
		);
	}
	if (props.query.isError || !props.query.data) {
		return (
			<section className="ops-section mt-6 min-w-0 scroll-mt-24" id="portal-automation">
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
		<section className="ops-section mt-6 min-w-0 scroll-mt-24" id="portal-automation">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="font-semibold text-foreground text-lg">开发者自动化访问</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						开发者程序使用下方端点和 Bearer token 创建、更新或删除凭据。
					</p>
				</div>
				<ActionGroup>
					<Button
						aria-label="刷新自动化 token"
						disabled={props.query.isFetching}
						onClick={() => void props.query.refetch()}
						size="icon"
						title="刷新自动化 token"
						variant="ghost"
					>
						<RefreshCw className="size-4" />
					</Button>
					<Button onClick={() => props.onOpen({ kind: "create" })}>
						<KeyRound className="size-4" />
						生成 token
					</Button>
				</ActionGroup>
			</div>
			<div className="mt-4 flex min-w-0 max-w-3xl items-center gap-2">
				<Input className="min-w-0 flex-1" aria-label="自动化接口地址" readOnly value={endpoint} />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							aria-label="复制自动化接口地址"
							onClick={() => {
								void navigator.clipboard.writeText(endpoint).then(() => setCopied(true));
							}}
							size="icon"
							variant="ghost"
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
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => Promise<unknown>;
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
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => Promise<unknown>;
	token: InternalPortalAutomationTokenMetadata;
}) {
	return (
		<div className="grid min-w-0 gap-3 border-border border-b px-1 py-4 last:border-b-0">
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
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
	onRevoke: (token: InternalPortalAutomationTokenMetadata) => Promise<unknown>;
	token: InternalPortalAutomationTokenMetadata;
}) {
	const confirmCommand = useConfirmCommand();

	return (
		<div className="flex justify-end gap-1">
			<IconAction
				icon={<Eye />}
				label="显示 token"
				onClick={() => props.onOpen({ kind: "reveal", token: props.token })}
			/>
			{props.token.revokedAt ? null : (
				<ConfirmDialog
					confirmLabel="撤销"
					description={`撤销“${props.token.name}”后，使用该 token 的程序将无法继续访问。`}
					{...confirmCommand("command", () => props.onRevoke(props.token))}
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
							variant="secondary"
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
						<Field label="名称">
							<Input
								autoFocus
								id="internal-portal-automation-token-name"
								maxLength={80}
								onChange={(event) => setName(event.target.value)}
								required
								value={name}
							/>
						</Field>
						{create.error ? <InlineError error={create.error} title="token 生成失败" /> : null}
						<DialogFooter>
							<Button onClick={props.onClose} variant="secondary">
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
						<Button onClick={props.onClose} variant="secondary">
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
							variant="secondary"
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
					<Button onClick={close} variant="secondary">
						关闭
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
