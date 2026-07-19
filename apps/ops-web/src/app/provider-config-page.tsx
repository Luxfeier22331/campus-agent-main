import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, RefreshCw, Rocket, ServerCog } from "lucide-react";
import { cloneElement, useId, useState } from "react";
import type { ProviderConfigStatus } from "../shared/ops-contract";
import { commandProviderConfig, fetchProviderConfig } from "./ops-api-client";
import { ErrorState, PageHeader } from "./ops-display";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { DataTable } from "./ui/data-table";

const inputClass = "min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm";

export function ProviderConfigPage() {
	const queryClient = useQueryClient();
	const status = useQuery({
		queryFn: ({ signal }) => fetchProviderConfig({ signal }),
		queryKey: ["ops", "provider-config"],
	});
	const [commandError, setCommandError] = useState<unknown>(null);
	const command = useMutation({
		mutationFn: async (input: {
			path: Parameters<typeof commandProviderConfig>[0];
			payload: unknown;
			idempotencyKey: string;
		}) =>
			commandProviderConfig(input.path, input.payload, { idempotencyKey: input.idempotencyKey }),
		onError: setCommandError,
		onSuccess: async () => {
			setCommandError(null);
			await queryClient.invalidateQueries({ queryKey: ["ops", "provider-config"] });
		},
	});

	if (status.isPending) {
		return (
			<section>
				<PageHeader
					description="管理 execution runtime 的模型连接和整包激活。"
					title="Provider Config"
				/>
				<p className="text-slate-600 text-sm">正在读取配置...</p>
			</section>
		);
	}
	if (status.isError || !status.data) {
		return (
			<section>
				<PageHeader
					description="管理 execution runtime 的模型连接和整包激活。"
					title="Provider Config"
				/>
				<ErrorState
					error={status.error}
					onRetry={() => void status.refetch()}
					title="Provider Config 读取失败"
				/>
			</section>
		);
	}
	const data = status.data;
	return (
		<section>
			<PageHeader
				actions={
					<Button
						aria-busy={status.isFetching}
						disabled={status.isFetching}
						onClick={() => void status.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						刷新
					</Button>
				}
				description="连接和 Profile 均为不可变 revision；激活始终原子替换完整运行 bundle。"
				title="Provider Config"
			/>
			<div className="mb-4 flex flex-wrap gap-2">
				<Badge tone={data.activeRevision > 0 ? "success" : "warning"}>
					Active revision {data.activeRevision}
				</Badge>
				{data.roles.map((role) => (
					<Badge
						className="max-w-full whitespace-normal break-all"
						key={role.role}
						tone={role.configured ? "success" : role.role === "rag_reranker" ? "muted" : "danger"}
					>
						{role.role}: {role.configured ? role.model : "未配置"}
					</Badge>
				))}
			</div>
			{commandError ? (
				<div className="mb-4">
					<ErrorState error={commandError} title="Provider Config 命令失败" />
				</div>
			) : null}
			<ProviderWriteControls command={command.mutate} data={data} pending={command.isPending} />
			<div className="mt-4 grid gap-4">
				<Card>
					<CardHeader>
						<CardTitle>Profiles</CardTitle>
					</CardHeader>
					<CardContent>
						<DataTable
							caption="Provider profiles"
							data={data.profiles}
							minWidth="820px"
							rowKey={(row) => row.profileId}
							columns={[
								{
									header: "Role",
									cell: (row) => <span className="font-mono text-xs">{row.role}</span>,
								},
								{ header: "Model", cell: (row) => row.model },
								{
									header: "Connection",
									cell: (row) => (
										<span className="font-mono text-xs">
											{row.connectionId}@{row.connectionRevision}
										</span>
									),
								},
								{ header: "Transport", cell: (row) => row.transport },
								{
									header: "Validation",
									cell: (row) => (
										<Badge
											tone={
												row.validationStatus === "passed"
													? "success"
													: row.validationStatus === "failed"
														? "danger"
														: "warning"
											}
										>
											{row.validationStatus}
										</Badge>
									),
								},
								{
									header: "Profile ID",
									cell: (row) => <span className="font-mono text-xs">{row.profileId}</span>,
								},
							]}
						/>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Connections</CardTitle>
					</CardHeader>
					<CardContent>
						<DataTable
							caption="Provider connections"
							data={data.connections}
							rowKey={(row) => `${row.connectionId}:${row.revision}`}
							columns={[
								{ header: "Provider", cell: (row) => row.provider },
								{
									header: "Connection",
									cell: (row) => (
										<span className="font-mono text-xs">
											{row.connectionId}@{row.revision}
										</span>
									),
								},
								{
									header: "Base URL",
									cell: (row) => <span className="break-all text-xs">{row.baseUrl}</span>,
								},
								{ header: "Features", cell: (row) => row.features.join(", ") },
								{
									header: "Secret",
									cell: (row) => <span className="font-mono text-xs">...{row.secretLast4}</span>,
								},
							]}
						/>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}

function ProviderWriteControls({
	command,
	data,
	pending,
}: {
	command: (input: {
		path: Parameters<typeof commandProviderConfig>[0];
		payload: unknown;
		idempotencyKey: string;
	}) => void;
	data: ProviderConfigStatus;
	pending: boolean;
}) {
	return (
		<div className="grid gap-4 xl:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRound className="size-4" />
						新建 Connection revision
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							command({
								idempotencyKey: crypto.randomUUID(),
								path: "connections",
								payload: {
									apiKey: form.get("apiKey"),
									baseUrl: form.get("baseUrl"),
									connectionId: form.get("connectionId"),
									featureConfig: {},
									features: form.getAll("features").map(String),
									provider: form.get("provider"),
								},
							});
							event.currentTarget.reset();
						}}
					>
						<Field label="Connection ID">
							<input className={inputClass} name="connectionId" placeholder="留空自动生成" />
						</Field>
						<Field label="Provider">
							<input className={inputClass} name="provider" required />
						</Field>
						<Field label="Base URL">
							<input className={inputClass} name="baseUrl" required type="url" />
						</Field>
						<fieldset className="grid gap-2">
							<legend className="font-medium text-slate-600 text-sm">Features</legend>
							<div className="flex flex-wrap gap-3">
								{(["prompt", "embedding", "rerank"] as const).map((feature) => (
									<label className="flex items-center gap-2 text-sm" key={feature}>
										<input
											defaultChecked={feature === "prompt"}
											name="features"
											type="checkbox"
											value={feature}
										/>
										{feature}
									</label>
								))}
							</div>
						</fieldset>
						<Field label="API key">
							<input
								autoComplete="new-password"
								className={inputClass}
								name="apiKey"
								required
								type="password"
							/>
						</Field>
						<Button disabled={pending} type="submit">
							<ServerCog className="size-4" />
							创建 revision
						</Button>
					</form>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<CheckCircle2 className="size-4" />
						新建并验证 Profile
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const role = String(form.get("role"));
							const kind =
								role === "primary_agent"
									? "prompt"
									: role === "rag_query_embedding"
										? "embedding"
										: "rerank";
							const connection = parseConnectionSelection(form.get("connection"));
							command({
								idempotencyKey: crypto.randomUUID(),
								path: "profiles",
								payload: {
									connectionId: connection.connectionId,
									connectionRevision: connection.revision,
									dimensions: kind === "embedding" ? Number(form.get("dimensions")) : 0,
									kind,
									model: form.get("model"),
									role,
									timeoutMs: Number(form.get("timeoutMs")),
									transport: form.get("transport"),
								},
							});
						}}
					>
						<Field label="Role">
							<select className={inputClass} name="role">
								<option value="primary_agent">primary_agent</option>
								<option value="rag_query_embedding">rag_query_embedding</option>
								<option value="rag_reranker">rag_reranker</option>
							</select>
						</Field>
						<Field label="Connection">
							<select className={inputClass} name="connection" required>
								{data.connections.map((connection) => (
									<option
										key={`${connection.connectionId}:${connection.revision}`}
										value={JSON.stringify([connection.connectionId, connection.revision])}
									>
										{connection.connectionId}@{connection.revision}
									</option>
								))}
							</select>
						</Field>
						<Field label="Model">
							<input className={inputClass} name="model" required />
						</Field>
						<Field label="Transport">
							<input className={inputClass} name="transport" required defaultValue="responses" />
						</Field>
						<Field label="Dimensions">
							<input
								className={inputClass}
								min="1"
								name="dimensions"
								type="number"
								defaultValue="2560"
							/>
						</Field>
						<Field label="Timeout (ms)">
							<input
								className={inputClass}
								min="1"
								name="timeoutMs"
								required
								type="number"
								defaultValue="30000"
							/>
						</Field>
						<Button disabled={pending || data.connections.length === 0} type="submit">
							<ServerCog className="size-4" />
							创建 Profile
						</Button>
						<div className="grid gap-2 border-slate-200 border-t pt-3">
							{data.profiles
								.filter((profile) => profile.validationStatus !== "passed")
								.map((profile) => (
									<Button
										key={profile.profileId}
										disabled={pending}
										onClick={() =>
											command({
												idempotencyKey: crypto.randomUUID(),
												path: `profiles/${profile.profileId}/validate`,
												payload: {},
											})
										}
										type="button"
										variant="outline"
									>
										<CheckCircle2 className="size-4" />
										验证 {profile.role}
									</Button>
								))}
						</div>
					</form>
				</CardContent>
			</Card>
			<ActivationForm command={command} data={data} pending={pending} />
		</div>
	);
}

function ActivationForm({
	command,
	data,
	pending,
}: {
	command: (input: { path: "activation"; payload: unknown; idempotencyKey: string }) => void;
	data: ProviderConfigStatus;
	pending: boolean;
}) {
	const validated = (role: string) =>
		data.profiles.filter(
			(profile) => profile.role === role && profile.validationStatus === "passed",
		);
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Rocket className="size-4" />
					激活完整 bundle
				</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						const reranker = String(form.get("rag_reranker") ?? "");
						command({
							path: "activation",
							idempotencyKey: crypto.randomUUID(),
							payload: {
								expectedRevision: data.activeRevision,
								profiles: {
									primary_agent: form.get("primary_agent"),
									rag_query_embedding: form.get("rag_query_embedding"),
									...(reranker ? { rag_reranker: reranker } : {}),
								},
							},
						});
					}}
				>
					{(["primary_agent", "rag_query_embedding", "rag_reranker"] as const).map((role) => (
						<Field key={role} label={role}>
							<select className={inputClass} name={role} required={role !== "rag_reranker"}>
								<option value="">{role === "rag_reranker" ? "不启用" : "请选择"}</option>
								{validated(role).map((profile) => (
									<option key={profile.profileId} value={profile.profileId}>
										{profile.model} / {profile.profileId}
									</option>
								))}
							</select>
						</Field>
					))}
					<Button
						disabled={
							pending ||
							validated("primary_agent").length === 0 ||
							validated("rag_query_embedding").length === 0
						}
						type="submit"
					>
						<Rocket className="size-4" />
						激活 revision {data.activeRevision + 1}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function Field({
	children,
	label,
}: {
	children: React.ReactElement<{ id?: string }>;
	label: string;
}) {
	const generatedId = useId();
	const controlId = children.props.id ?? generatedId;
	return (
		<div className="grid gap-1 text-sm">
			<label className="font-medium text-slate-600" htmlFor={controlId}>
				{label}
			</label>
			{cloneElement(children, { id: controlId })}
		</div>
	);
}

function parseConnectionSelection(value: FormDataEntryValue | null) {
	const parsed = JSON.parse(String(value)) as unknown;
	if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || !Number.isSafeInteger(parsed[1])) {
		throw new Error("Connection revision selection is invalid.");
	}
	return { connectionId: parsed[0], revision: parsed[1] as number };
}
