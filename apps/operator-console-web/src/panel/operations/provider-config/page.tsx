import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, PlusCircle, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { getPanelErrorMessage } from "../../panel-error";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "../../ui/empty";
import { Field, FieldError, FieldLabel } from "../../ui/field";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Skeleton } from "../../ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableHeader,
	TableRow,
} from "../../ui/table";
import {
	activateProviderConfigProfile,
	createProviderConfigConnection,
	createProviderConfigProfile,
	listProviderConfigConnections,
	listProviderConfigProfiles,
	updateProviderConfigProfile,
	validateProviderConfigProfile,
} from "./api";
import type { ProviderConfigProfileUpdatePayload, ProviderConfigRole } from "./model";
import {
	buildConnectionCreatePayload,
	buildProfileCreatePayload,
	buildProfileUpdatePayload,
	type ConnectionFormState,
	connectionFormSchema,
	defaultTransportForRole,
	FEATURE_PRESET_LABEL,
	featureLabel,
	formFromProfile,
	initialConnectionForm,
	initialProfileForm,
	isEditableProfileRole,
	KIND_LABEL,
	kindForRole,
	omitRecordKey,
	type ProfileFormState,
	profileFormSchema,
	ROLE_LABEL,
	ROLE_OPTIONS,
	roleLabel,
	STATUS_LABEL,
	searchTransportForConnection,
	sortConnections,
	sortProfiles,
	transportLabel,
} from "./view-model";

export function ProviderConfigPage() {
	const queryClient = useQueryClient();
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
	const [connectionFormError, setConnectionFormError] = useState<string | null>(null);
	const [profileFormError, setProfileFormError] = useState<string | null>(null);
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [validatingProfileId, setValidatingProfileId] = useState<string | null>(null);
	const [activatingProfileId, setActivatingProfileId] = useState<string | null>(null);
	const connectionForm = useForm<ConnectionFormState>({
		defaultValues: initialConnectionForm(),
		resolver: zodResolver(connectionFormSchema),
	});
	const profileForm = useForm<ProfileFormState>({
		defaultValues: initialProfileForm(),
		resolver: zodResolver(profileFormSchema),
	});
	const connectionsQuery = useQuery({
		queryFn: ({ signal }) => listProviderConfigConnections({ signal }),
		queryKey: ["provider-config", "connections"],
	});
	const profilesQuery = useQuery({
		queryFn: ({ signal }) => listProviderConfigProfiles({ signal }),
		queryKey: ["provider-config", "profiles"],
	});
	const selectedRole = profileForm.watch("role");
	const selectedKind = kindForRole(selectedRole);
	const selectedConnectionId = profileForm.watch("connectionId");
	const selectedTransport = profileForm.watch("transport");
	const isEditing = editingProfileId !== null;
	const connections = sortConnections(connectionsQuery.data?.connections ?? []);
	const compatibleConnections = connections.filter((connection) =>
		connection.features.includes(selectedKind),
	);
	const selectedConnection = connections.find(
		(connection) => connection.connectionId === selectedConnectionId,
	);
	const displayedTransport =
		selectedKind === "embedding"
			? "embeddings"
			: selectedKind === "search"
				? searchTransportForConnection(selectedConnection)
				: selectedTransport;
	const profiles = sortProfiles(profilesQuery.data?.profiles ?? []);

	useEffect(() => {
		if (isEditing || selectedConnectionId || compatibleConnections.length === 0) {
			return;
		}
		profileForm.setValue("connectionId", compatibleConnections[0]?.connectionId ?? "");
	}, [compatibleConnections, isEditing, profileForm, selectedConnectionId]);

	const invalidateConnections = () => {
		void queryClient.invalidateQueries({ queryKey: ["provider-config", "connections"] });
	};
	const invalidateProfiles = () => {
		void queryClient.invalidateQueries({ queryKey: ["provider-config", "profiles"] });
	};
	const createConnectionMutation = useMutation({
		mutationFn: createProviderConfigConnection,
		onError: (error) => {
			setConnectionFormError(getPanelErrorMessage(error, "保存连接失败。"));
		},
		onSuccess: (result) => {
			connectionForm.reset(initialConnectionForm());
			setConnectionFormError(null);
			invalidateConnections();
			profileForm.setValue("connectionId", result.connection.connectionId);
		},
	});
	const createProfileMutation = useMutation({
		mutationFn: createProviderConfigProfile,
		onError: (error) => {
			setProfileFormError(getPanelErrorMessage(error, "保存配置档案失败。"));
		},
		onSuccess: () => {
			profileForm.reset(initialProfileForm());
			setEditingProfileId(null);
			setProfileFormError(null);
			invalidateProfiles();
		},
	});
	const updateProfileMutation = useMutation({
		mutationFn: (input: { payload: ProviderConfigProfileUpdatePayload; profileId: string }) =>
			updateProviderConfigProfile(input.profileId, input.payload),
		onError: (error) => {
			setProfileFormError(getPanelErrorMessage(error, "保存配置档案失败。"));
		},
		onSuccess: () => {
			setEditingProfileId(null);
			profileForm.reset(initialProfileForm());
			setProfileFormError(null);
			invalidateProfiles();
		},
	});
	const validateMutation = useMutation({
		mutationFn: validateProviderConfigProfile,
		onError: (error, profileId) => {
			setRowErrors((current) => ({
				...current,
				[profileId]: getPanelErrorMessage(error, "校验失败。"),
			}));
		},
		onSettled: () => setValidatingProfileId(null),
		onSuccess: (_result, profileId) => {
			setRowErrors((current) => omitRecordKey(current, profileId));
			invalidateProfiles();
		},
	});
	const activateMutation = useMutation({
		mutationFn: activateProviderConfigProfile,
		onError: (error, profileId) => {
			setRowErrors((current) => ({
				...current,
				[profileId]: getPanelErrorMessage(error, "启用失败。"),
			}));
		},
		onSettled: () => setActivatingProfileId(null),
		onSuccess: (_result, profileId) => {
			setRowErrors((current) => omitRecordKey(current, profileId));
			invalidateProfiles();
		},
	});

	return (
		<section className="space-y-4">
			<Card>
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">模型服务连接</p>
					<CardTitle>Provider Connection</CardTitle>
					<CardDescription>保存模型服务端点、密钥和支持的能力。</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3 lg:grid-cols-4"
						onSubmit={connectionForm.handleSubmit((values) => {
							setConnectionFormError(null);
							createConnectionMutation.mutate(buildConnectionCreatePayload(values));
						})}
					>
						<Controller
							control={connectionForm.control}
							name="provider"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-connection-provider">服务类型</FieldLabel>
									<Select onValueChange={field.onChange} value={field.value}>
										<SelectTrigger id="provider-connection-provider">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="openai-compatible">OpenAI-compatible</SelectItem>
											<SelectItem value="openai">OpenAI</SelectItem>
											<SelectItem value="perplexity">Perplexity</SelectItem>
											<SelectItem value="perplexity_compatible">Perplexity-compatible</SelectItem>
											<SelectItem value="gemini">Gemini</SelectItem>
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="provider-connection-base-url">服务端点</FieldLabel>
							<Input id="provider-connection-base-url" {...connectionForm.register("baseUrl")} />
							{connectionForm.formState.errors.baseUrl ? (
								<FieldError>{connectionForm.formState.errors.baseUrl.message}</FieldError>
							) : null}
						</Field>
						<Controller
							control={connectionForm.control}
							name="featurePreset"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-connection-features">支持能力</FieldLabel>
									<Select onValueChange={field.onChange} value={field.value}>
										<SelectTrigger id="provider-connection-features">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{Object.entries(FEATURE_PRESET_LABEL).map(([value, label]) => (
												<SelectItem key={value} value={value}>
													{label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="provider-connection-api-key">密钥</FieldLabel>
							<Input
								autoComplete="off"
								id="provider-connection-api-key"
								type="password"
								{...connectionForm.register("apiKey")}
							/>
							{connectionForm.formState.errors.apiKey ? (
								<FieldError>{connectionForm.formState.errors.apiKey.message}</FieldError>
							) : null}
						</Field>
						<div className="lg:col-span-4">
							<Button
								disabled={
									createConnectionMutation.isPending ||
									!connectionForm.watch("apiKey").trim() ||
									!connectionForm.watch("baseUrl").trim()
								}
								type="submit"
								variant="primary"
							>
								<PlusCircle aria-hidden="true" className="size-4" />
								保存连接
							</Button>
						</div>
						{connectionFormError ? (
							<Alert className="lg:col-span-4" tone="danger">
								{connectionFormError}
							</Alert>
						) : null}
					</form>
				</CardContent>
			</Card>

			<Card className="overflow-hidden">
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">连接清单</p>
					<CardTitle>已保存连接</CardTitle>
				</CardHeader>
				<CardContent className="p-0">
					{connectionsQuery.isLoading ? (
						<div className="space-y-2 p-5">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : null}
					{connectionsQuery.error ? (
						<div className="p-5">
							<Alert tone="danger">
								{getPanelErrorMessage(connectionsQuery.error, "连接列表读取失败。")}
							</Alert>
						</div>
					) : null}
					<TableContainer className="rounded-none border-0 border-t">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>服务类型</TableHead>
									<TableHead>服务端点</TableHead>
									<TableHead>支持能力</TableHead>
									<TableHead>密钥</TableHead>
									<TableHead>更新时间</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{connections.map((connection) => (
									<TableRow key={connection.connectionId}>
										<TableCell>{connection.provider}</TableCell>
										<TableCell className="font-mono text-xs">{connection.baseUrl}</TableCell>
										<TableCell>{connection.features.map(featureLabel).join(" / ")}</TableCell>
										<TableCell className="font-mono text-xs">
											****{connection.secretLast4}
										</TableCell>
										<TableCell className="font-mono text-xs">{connection.updatedAt}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableContainer>
					{connectionsQuery.data?.connections?.length === 0 ? (
						<Empty className="m-5">
							<EmptyTitle>暂无模型服务连接</EmptyTitle>
							<EmptyDescription>请先保存一个支持生成模型的连接。</EmptyDescription>
						</Empty>
					) : null}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">配置档案</p>
					<CardTitle>Runtime Profile</CardTitle>
					<CardDescription>为使用位置绑定连接、模型名称和接口协议。</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3 lg:grid-cols-4"
						onSubmit={profileForm.handleSubmit((values) => {
							setProfileFormError(null);
							if (editingProfileId) {
								updateProfileMutation.mutate({
									payload: buildProfileUpdatePayload(values, connections),
									profileId: editingProfileId,
								});
								return;
							}
							createProfileMutation.mutate(buildProfileCreatePayload(values, connections));
						})}
					>
						<Controller
							control={profileForm.control}
							name="role"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-profile-role">使用位置</FieldLabel>
									<Select
										disabled={isEditing}
										onValueChange={(value) => {
											const nextKind = kindForRole(value as ProviderConfigRole);
											field.onChange(value);
											profileForm.setValue(
												"transport",
												defaultTransportForRole(value as ProviderConfigRole),
											);
											const nextConnection = connections.find((connection) =>
												connection.features.includes(nextKind),
											);
											profileForm.setValue("connectionId", nextConnection?.connectionId ?? "");
											if (nextKind === "search") {
												profileForm.setValue(
													"transport",
													searchTransportForConnection(nextConnection),
												);
											}
										}}
										value={field.value}
									>
										<SelectTrigger id="provider-profile-role">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ROLE_OPTIONS.map((option) => (
												<SelectItem key={option.role} value={option.role}>
													{ROLE_LABEL[option.role]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Controller
							control={profileForm.control}
							name="connectionId"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-profile-connection">模型连接</FieldLabel>
									<Select
										onValueChange={(value) => {
											field.onChange(value);
											if (selectedKind === "search") {
												const connection = connections.find(
													(candidate) => candidate.connectionId === value,
												);
												profileForm.setValue("transport", searchTransportForConnection(connection));
											}
										}}
										value={field.value}
									>
										<SelectTrigger id="provider-profile-connection">
											<SelectValue placeholder="选择连接" />
										</SelectTrigger>
										<SelectContent>
											{compatibleConnections.map((connection) => (
												<SelectItem key={connection.connectionId} value={connection.connectionId}>
													{connection.provider} / {connection.baseUrl}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{compatibleConnections.length === 0 ? (
										<span className="mt-1 text-slate-500 text-xs">
											没有支持{KIND_LABEL[selectedKind]}的连接。
										</span>
									) : null}
									{profileForm.formState.errors.connectionId ? (
										<FieldError>{profileForm.formState.errors.connectionId.message}</FieldError>
									) : null}
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="provider-profile-model">模型名称</FieldLabel>
							<Input id="provider-profile-model" {...profileForm.register("model")} />
							{profileForm.formState.errors.model ? (
								<FieldError>{profileForm.formState.errors.model.message}</FieldError>
							) : null}
						</Field>
						<Field>
							<FieldLabel htmlFor="provider-profile-timeout">超时时间</FieldLabel>
							<Input
								id="provider-profile-timeout"
								inputMode="numeric"
								{...profileForm.register("timeoutMs")}
							/>
							{profileForm.formState.errors.timeoutMs ? (
								<FieldError>{profileForm.formState.errors.timeoutMs.message}</FieldError>
							) : null}
						</Field>
						<Controller
							control={profileForm.control}
							name="transport"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-profile-transport">接口协议</FieldLabel>
									<Select
										disabled={selectedKind === "embedding" || selectedKind === "search"}
										onValueChange={field.onChange}
										value={displayedTransport}
									>
										<SelectTrigger id="provider-profile-transport">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="responses">Responses</SelectItem>
											<SelectItem value="chat_completions">Chat Completions</SelectItem>
											{selectedKind === "embedding" ? (
												<SelectItem value="embeddings">Embeddings</SelectItem>
											) : null}
											{selectedKind === "search" ? (
												<SelectItem value={displayedTransport}>
													{transportLabel(displayedTransport)}
												</SelectItem>
											) : null}
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="provider-profile-dimensions">向量维度</FieldLabel>
							<Input
								disabled={selectedKind !== "embedding"}
								id="provider-profile-dimensions"
								inputMode="numeric"
								{...profileForm.register("dimensions")}
							/>
							{selectedKind === "embedding" ? null : (
								<span className="mt-1 text-slate-500 text-xs">
									{KIND_LABEL[selectedKind]}不需要向量维度
								</span>
							)}
							{selectedKind === "embedding" && profileForm.formState.errors.dimensions ? (
								<FieldError>{profileForm.formState.errors.dimensions.message}</FieldError>
							) : null}
						</Field>
						<div className="lg:col-span-4">
							<Button
								disabled={
									createProfileMutation.isPending ||
									updateProfileMutation.isPending ||
									!profileForm.watch("connectionId").trim() ||
									!profileForm.watch("model").trim()
								}
								type="submit"
								variant="primary"
							>
								<KeyRound aria-hidden="true" className="size-4" />
								{isEditing ? "保存配置档案" : "保存配置档案"}
							</Button>
							{isEditing ? (
								<Button
									className="ml-2"
									disabled={updateProfileMutation.isPending}
									onClick={() => {
										setEditingProfileId(null);
										profileForm.reset(initialProfileForm());
										setProfileFormError(null);
									}}
									type="button"
									variant="secondary"
								>
									<XCircle aria-hidden="true" className="size-4" />
									取消编辑
								</Button>
							) : null}
						</div>
						{profileFormError ? (
							<Alert className="lg:col-span-4" tone="danger">
								{profileFormError}
							</Alert>
						) : null}
					</form>
				</CardContent>
			</Card>

			<Card className="overflow-hidden">
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">运行档案</p>
					<CardTitle>已保存 Runtime Profiles</CardTitle>
				</CardHeader>
				<CardContent className="p-0">
					{profilesQuery.isLoading ? (
						<div className="space-y-2 p-5">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : null}
					{profilesQuery.error ? (
						<div className="p-5">
							<Alert tone="danger">
								{getPanelErrorMessage(profilesQuery.error, "配置档案列表读取失败。")}
							</Alert>
						</div>
					) : null}
					<TableContainer className="rounded-none border-0 border-t">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>使用位置</TableHead>
									<TableHead>类型</TableHead>
									<TableHead>状态</TableHead>
									<TableHead>接口协议</TableHead>
									<TableHead>模型名称</TableHead>
									<TableHead>服务端点</TableHead>
									<TableHead>密钥</TableHead>
									<TableHead>校验</TableHead>
									<TableHead>操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{profiles.map((profile) => {
									const isValidating = validatingProfileId === profile.profileId;
									const isActivating = activatingProfileId === profile.profileId;
									return (
										<TableRow key={profile.profileId}>
											<TableCell>{roleLabel(profile.role)}</TableCell>
											<TableCell>{KIND_LABEL[profile.kind]}</TableCell>
											<TableCell>
												<span className="inline-flex items-center gap-1">
													{profile.active ? (
														<CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
													) : null}
													{STATUS_LABEL[profile.status]}
												</span>
											</TableCell>
											<TableCell>{transportLabel(profile.transport)}</TableCell>
											<TableCell className="font-mono text-xs">{profile.model}</TableCell>
											<TableCell className="font-mono text-xs">{profile.baseUrl}</TableCell>
											<TableCell className="font-mono text-xs">****{profile.secretLast4}</TableCell>
											<TableCell>
												<div className="space-y-2">
													{profile.validation?.ok === true ? (
														<span className="inline-flex items-center gap-1 text-emerald-700">
															<ShieldCheck aria-hidden="true" className="size-4" />
															通过
														</span>
													) : profile.validation ? (
														<span className="inline-flex items-center gap-1 text-red-700">
															<XCircle aria-hidden="true" className="size-4" />
															{profile.validation.errorCode ?? "失败"}
														</span>
													) : (
														"未校验"
													)}
													{rowErrors[profile.profileId] ? (
														<Alert className="px-3 py-2" tone="danger">
															{rowErrors[profile.profileId]}
														</Alert>
													) : null}
												</div>
											</TableCell>
											<TableCell>
												<div className="flex flex-wrap gap-2">
													<Button
														disabled={
															profile.active ||
															!isEditableProfileRole(profile.role) ||
															updateProfileMutation.isPending
														}
														onClick={() => {
															setEditingProfileId(profile.profileId);
															profileForm.reset(formFromProfile(profile));
															setProfileFormError(null);
														}}
														size="sm"
														type="button"
														variant="secondary"
													>
														<Pencil aria-hidden="true" className="size-4" />
														编辑
													</Button>
													<Button
														disabled={isValidating}
														onClick={() => {
															setValidatingProfileId(profile.profileId);
															setRowErrors((current) => omitRecordKey(current, profile.profileId));
															validateMutation.mutate(profile.profileId);
														}}
														size="sm"
														type="button"
														variant="secondary"
													>
														<ShieldCheck aria-hidden="true" className="size-4" />
														{isValidating ? "校验中" : "校验"}
													</Button>
													<Button
														disabled={
															isActivating || profile.active || profile.validation?.ok !== true
														}
														onClick={() => {
															setActivatingProfileId(profile.profileId);
															setRowErrors((current) => omitRecordKey(current, profile.profileId));
															activateMutation.mutate(profile.profileId);
														}}
														size="sm"
														type="button"
														variant="primary"
													>
														<CheckCircle2 aria-hidden="true" className="size-4" />
														{isActivating ? "启用中" : "启用"}
													</Button>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</TableContainer>
					{profilesQuery.data?.profiles.length === 0 ? (
						<Empty className="m-5">
							<EmptyTitle>暂无配置档案</EmptyTitle>
							<EmptyDescription>请先创建主问答生成配置档案。</EmptyDescription>
						</Empty>
					) : null}
				</CardContent>
			</Card>
		</section>
	);
}
