import {
	ActionGroup,
	Button,
	Card,
	CardContent,
	cn,
	Field,
	Input,
	StateMessage,
} from "@campus-agent/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type {
	ExecutionModelSettingsStatus,
	NoticeClassificationBackend,
	NoticeClassificationCredential,
	NoticeClassificationCredentialUpdate,
	NoticeClassificationSettings,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { OpsApiError } from "./ops-api/core";
import {
	discoverNoticeClassificationModels,
	putNoticeClassificationCredential,
	selectNoticeClassificationBackend,
	validateNoticeClassificationCredential,
} from "./ops-api/model-settings";
import { InlineError } from "./ops-display";
import { SecretField } from "./provider-config-form";
import { credentialHelperText, providerLabel } from "./provider-config-model";
import {
	executionModelSettingsQueryKey,
	InlineNotice,
	transportLabel,
	UnsavedChangesGuard,
	ValidationBadge,
	validationDetail,
} from "./provider-config-ui";
import { FilterSelect } from "./ui/filter-select";

const backends: {
	value: NoticeClassificationBackend;
	label: string;
	description: string;
}[] = [
	{
		value: "decision",
		label: "决策模型",
		description: "System One 接口逐题判定（Nace Drex 或 TypeSafe Jev）",
	},
	{ value: "llm", label: "LLM", description: "OpenAI 兼容接口结构化输出" },
];

function useStatusUpdate() {
	const client = useQueryClient();
	return (next: ExecutionModelSettingsStatus) => {
		client.setQueryData(executionModelSettingsQueryKey, next);
	};
}

export function NoticeClassificationForm({ settings }: { settings: NoticeClassificationSettings }) {
	return (
		<Card>
			<CardContent className="space-y-6 p-5">
				<div>
					<h3 className="font-semibold">通知分类</h3>
					<p className="text-muted-foreground text-sm">
						规则未覆盖的内部通知交给所选后端判定。两个后端各自保存凭据，切换不会丢失已保存的 API
						Key，只影响之后开始的分类任务。
					</p>
				</div>
				<BackendSelection key={settings.backend ?? "none"} settings={settings} />
				{backends.map((backend) => (
					<CredentialForm
						backend={backend}
						credential={settings.credentials[backend.value]}
						key={`${backend.value}:${settings.credentials[backend.value]?.updatedAt ?? "none"}`}
						selected={settings.backend === backend.value}
					/>
				))}
			</CardContent>
		</Card>
	);
}

function BackendSelection({ settings }: { settings: NoticeClassificationSettings }) {
	const onSuccess = useStatusUpdate();
	const [backend, setBackend] = useState<NoticeClassificationBackend | null>(settings.backend);
	const dirty = backend !== settings.backend;
	const save = useMutation({
		mutationFn: (next: NoticeClassificationBackend) => selectNoticeClassificationBackend(next),
		onSuccess,
	});
	return (
		<form
			className="grid gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (backend) {
					save.mutate(backend);
				}
			}}
		>
			<UnsavedChangesGuard dirty={dirty} />
			<fieldset className="grid min-w-0 gap-4 md:grid-cols-2" disabled={save.isPending}>
				<Field id="notice-classification-backend" label="当前分类后端">
					<FilterSelect
						className="min-h-11"
						id="notice-classification-backend"
						onValueChange={(value) => setBackend(value as NoticeClassificationBackend)}
						options={[
							...(backend === null ? [{ disabled: true, label: "尚未选择", value: "" }] : []),
							...backends.map((candidate) => ({
								disabled:
									settings.credentials[candidate.value]?.latestValidation?.status !== "passed",
								label: candidate.label,
								value: candidate.value,
							})),
						]}
						value={backend ?? ""}
					/>
				</Field>
				<p className="self-end text-muted-foreground text-sm">
					{backend === null
						? "尚未选择后端，通知分类任务无法运行。只能选择验证通过的凭据。"
						: backends.find((candidate) => candidate.value === backend)?.description}
				</p>
			</fieldset>
			{save.isError ? <InlineError error={save.error} title="切换失败，当前后端未更改" /> : null}
			{dirty ? (
				<ActionGroup>
					<Button disabled={save.isPending} type="submit">
						{save.isPending ? "切换中…" : "切换"}
					</Button>
					<Button
						onClick={() => {
							setBackend(settings.backend);
							save.reset();
						}}
						type="button"
						variant="ghost"
					>
						放弃更改
					</Button>
				</ActionGroup>
			) : null}
		</form>
	);
}

interface CredentialDraft {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: "openai" | "openai-compatible" | "nace" | "typesafe";
	transport: "responses" | "chat_completions";
}

function draftFrom(
	backend: NoticeClassificationBackend,
	credential: NoticeClassificationCredential | null,
): CredentialDraft {
	const provider =
		backend === "decision"
			? credential?.provider === "typesafe"
				? "typesafe"
				: "nace"
			: credential?.provider === "openai"
				? "openai"
				: "openai-compatible";
	return {
		apiKey: "",
		baseUrl: credential?.baseUrl ?? "",
		model: credential?.model ?? "",
		provider,
		transport: credential?.transport === "responses" ? "responses" : "chat_completions",
	};
}

function CredentialForm({
	backend,
	credential,
	selected,
}: {
	backend: (typeof backends)[number];
	credential: NoticeClassificationCredential | null;
	selected: boolean;
}) {
	const onSuccess = useStatusUpdate();
	const queryClient = useQueryClient();
	const llm = backend.value === "llm";
	const baseline = draftFrom(backend.value, credential);
	const [draft, setDraft] = useState<CredentialDraft>(baseline);
	const [feedback, setFeedback] = useState<string | null>(null);
	const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
	const save = useMutation({
		mutationFn: () =>
			putNoticeClassificationCredential(backend.value, {
				...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
				baseUrl: draft.baseUrl,
				model: draft.model,
				provider: draft.provider,
				...(llm ? { transport: draft.transport } : {}),
			} as NoticeClassificationCredentialUpdate),
		onSuccess: (next) => {
			onSuccess(next);
			setFeedback("凭据已保存并验证通过。");
		},
	});
	const revalidate = useMutation({
		mutationFn: () => validateNoticeClassificationCredential(backend.value),
		// A failed revalidation is recorded upstream; refresh to show it.
		onSettled: () =>
			queryClient.invalidateQueries({ exact: true, queryKey: executionModelSettingsQueryKey }),
		onSuccess: (next) => {
			onSuccess(next);
			setFeedback("当前凭据已重新验证。");
		},
	});
	const discovery = useMutation({
		mutationFn: () =>
			discoverNoticeClassificationModels(backend.value, {
				...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
				baseUrl: draft.baseUrl,
				provider: draft.provider,
			}),
	});
	const update = (patch: Partial<CredentialDraft>) => {
		setDraft((current) => ({ ...current, ...patch }));
		save.reset();
		revalidate.reset();
		setFeedback(null);
	};
	const id = `notice-classification-${backend.value}`;
	const pending = save.isPending || revalidate.isPending;
	return (
		<form
			aria-busy={pending}
			className="grid gap-4 border-t pt-4"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<UnsavedChangesGuard dirty={dirty} />
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h4 className="font-semibold text-sm">
					{backend.label} 凭据{selected ? "（当前使用）" : ""}
				</h4>
				{credential ? <ValidationBadge validation={credential.latestValidation} /> : null}
			</div>
			<fieldset className="grid min-w-0 gap-4 md:grid-cols-2" disabled={pending}>
				<Field id={`${id}-base-url`} label="Base URL">
					<Input
						className="min-h-11"
						id={`${id}-base-url`}
						onChange={(event) => update({ baseUrl: event.target.value })}
						placeholder="https://provider.example/v1"
						required
						spellCheck={false}
						type="url"
						value={draft.baseUrl}
					/>
				</Field>
				<SecretField
					helper={credentialHelperText({
						credentialConfigured: credential?.credentialConfigured ?? false,
					})}
					label={`通知分类 ${backend.label} API Key`}
					onChange={(value) => update({ apiKey: value })}
					value={draft.apiKey}
				/>
				<div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto] md:col-span-2">
					<Field id={`${id}-model`} label="模型">
						{discovery.data && discovery.data.models.length > 0 ? (
							<FilterSelect
								className="min-h-11 min-w-0"
								id={`${id}-model`}
								onValueChange={(value) => update({ model: value })}
								options={[
									...(draft.model && !discovery.data.models.includes(draft.model)
										? [{ label: draft.model, value: draft.model }]
										: []),
									...discovery.data.models.map((model) => ({ label: model, value: model })),
								]}
								value={draft.model}
							/>
						) : (
							<Input
								className="min-h-11 min-w-0"
								id={`${id}-model`}
								onChange={(event) => update({ model: event.target.value })}
								required
								value={draft.model}
							/>
						)}
					</Field>
					<Button
						aria-label={`获取通知分类 ${backend.label} 模型`}
						disabled={discovery.isPending || !draft.baseUrl}
						onClick={() => discovery.mutate()}
						type="button"
						variant="secondary"
					>
						<RefreshCw className={cn("size-4", discovery.isPending && "animate-spin")} />
						{discovery.isPending ? "正在获取" : "获取模型"}
					</Button>
				</div>
				<Field id={`${id}-provider`} label="服务商">
					<FilterSelect
						className="min-h-11"
						id={`${id}-provider`}
						onValueChange={(value) => update({ provider: value as CredentialDraft["provider"] })}
						options={
							llm
								? [
										{ label: "OpenAI", value: "openai" },
										{ label: "OpenAI 兼容接口", value: "openai-compatible" },
									]
								: [
										{ label: providerLabel("nace"), value: "nace" },
										{ label: providerLabel("typesafe"), value: "typesafe" },
									]
						}
						value={draft.provider}
					/>
				</Field>
				{llm ? (
					<>
						<Field id={`${id}-transport`} label="接口类型">
							<FilterSelect
								className="min-h-11"
								id={`${id}-transport`}
								onValueChange={(value) =>
									update({ transport: value as CredentialDraft["transport"] })
								}
								options={[
									{ label: "Chat Completions API", value: "chat_completions" },
									{ label: "Responses API", value: "responses" },
								]}
								value={draft.transport}
							/>
						</Field>
					</>
				) : null}
			</fieldset>
			{discovery.data ? (
				<StateMessage
					description={<>已获取 {discovery.data.models.length} 个模型</>}
					layout="inline"
					role="status"
				/>
			) : null}
			{discovery.isError ? <InlineError error={discovery.error} title="模型列表获取失败" /> : null}
			<p className="text-muted-foreground text-sm">
				{credential
					? `${validationDetail(credential.latestValidation)} · ${transportLabel(credential.transport)} · ${formatTimestamp(credential.updatedAt)} · ${credential.updatedBy}`
					: "尚未配置"}
			</p>
			{feedback ? <InlineNotice>{feedback}</InlineNotice> : null}
			{save.isError ? (
				<InlineError
					error={save.error}
					title={
						save.error instanceof OpsApiError && save.error.status === 422
							? "新凭据验证未通过，当前凭据未更改"
							: "保存失败"
					}
				/>
			) : null}
			{revalidate.isError ? <InlineError error={revalidate.error} title="重新验证失败" /> : null}
			<ActionGroup>
				<Button disabled={!dirty || pending} type="submit">
					{save.isPending ? "验证并保存中" : "保存并验证"}
				</Button>
				{credential && !dirty ? (
					<Button
						disabled={pending}
						onClick={() => {
							setFeedback(null);
							revalidate.mutate();
						}}
						type="button"
						variant="secondary"
					>
						<RefreshCw className={cn("size-4", revalidate.isPending && "animate-spin")} />
						{revalidate.isPending ? "重新验证中" : "重新验证"}
					</Button>
				) : null}
				{dirty ? (
					<Button
						onClick={() => {
							setDraft(baseline);
							save.reset();
							setFeedback(null);
						}}
						type="button"
						variant="ghost"
					>
						放弃更改
					</Button>
				) : null}
			</ActionGroup>
		</form>
	);
}
