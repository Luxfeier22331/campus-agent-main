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
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Copy,
	Eye,
	Pencil,
	Plus,
	RefreshCw,
	RotateCw,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useState } from "react";
import type { InternalPortalCredential } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { InternalPortalIconAction as IconAction } from "./internal-portal-icon-action";
import {
	createInternalPortalCredential,
	deleteInternalPortalCredential,
	fetchInternalPortalCredentials,
	renameInternalPortalCredential,
	revealInternalPortalCredential,
	rotateInternalPortalCredential,
	validateInternalPortalCredential,
} from "./ops-api/internal-portal";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { DataTable } from "./ui/data-table";
import { useConfirmCommand } from "./use-confirm-command";

const CREDENTIALS_QUERY_KEY = ["ops", "internal-portal", "credentials"] as const;

type CredentialDialog =
	| { kind: "create" }
	| { credential: InternalPortalCredential; kind: "rename" | "reveal" | "rotate" }
	| null;

export function InternalPortalCredentialsSection() {
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<CredentialDialog>(null);
	const [commandError, setCommandError] = useState<unknown>(null);
	const credentials = useQuery({
		queryFn: ({ signal }) => fetchInternalPortalCredentials({ signal }),
		queryKey: CREDENTIALS_QUERY_KEY,
	});
	const refresh = async () => {
		await queryClient.invalidateQueries({ exact: true, queryKey: CREDENTIALS_QUERY_KEY });
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

	if (credentials.isPending) {
		return (
			<section>
				<PageHeader headingLevel={2} title="内部门户凭据" />
				<StateMessage layout="inline" description="正在读取凭据..." />
			</section>
		);
	}
	if (credentials.isError || !credentials.data) {
		return (
			<section>
				<PageHeader headingLevel={2} title="内部门户凭据" />
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
			return remove.mutateAsync(credential);
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
		<>
			<section>
				<PageHeader
					headingLevel={2}
					actions={
						<ActionGroup>
							<Button
								aria-label="刷新凭据"
								disabled={credentials.isFetching}
								onClick={() => void credentials.refetch()}
								size="icon"
								title="刷新凭据"
								variant="ghost"
							>
								<RefreshCw className="size-4" />
							</Button>
							<Button onClick={() => actions.open({ kind: "create" })}>
								<Plus className="size-4" />
								新增凭据
							</Button>
						</ActionGroup>
					}
					description="维护采集凭据、轮换内容与连接检查结果。"
					title="内部门户凭据"
				/>
				{commandError ? (
					<div className="mb-5">
						<ErrorState error={commandError} title="凭据操作失败" />
					</div>
				) : null}
				{rows.length === 0 ? (
					<StateMessage layout="inline" description="尚无内部门户凭据。" />
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
		</>
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
	delete: (credential: InternalPortalCredential) => Promise<unknown>;
	open: (dialog: Exclude<CredentialDialog, null>) => void;
	validate: (credentialId: string) => void;
}

function CredentialActions(props: {
	actions: CredentialActions;
	credential: InternalPortalCredential;
}) {
	const confirmCommand = useConfirmCommand();

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
			<ConfirmDialog
				confirmLabel="删除"
				description={`将删除“${props.credential.name}”。`}
				{...confirmCommand("delete", () => props.actions.delete(props.credential))}
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

function CredentialMobileRow(props: {
	actions: CredentialActions;
	credential: InternalPortalCredential;
}) {
	return (
		<div className="grid min-w-0 gap-3 border-border border-b px-1 py-4 last:border-b-0">
			<div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
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
					<Field label="名称">
						<Input
							autoFocus
							id="internal-portal-rename"
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
							required
							value={name}
						/>
					</Field>
					{rename.error ? <InlineError error={rename.error} title="重命名失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="secondary">
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
						<Button onClick={props.onClose} variant="secondary">
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
							variant="secondary"
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
					<Button onClick={close} variant="secondary">
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
					<Field label="名称">
						<Input
							autoFocus
							id="internal-portal-create-name"
							maxLength={80}
							onChange={(event) => props.onNameChange(event.target.value)}
							required
							value={props.name}
						/>
					</Field>
					<TgcInput onChange={props.onTgcChange} value={props.ssoTgc} />
					{props.error ? <InlineError error={props.error} title="凭据新增失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="secondary">
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
		<Field label="SSO_TGC 或 Cookie">
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
		</Field>
	);
}
