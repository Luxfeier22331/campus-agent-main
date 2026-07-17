import { randomUUID } from "node:crypto";
import {
	createProjection,
	type ProviderConfigActor,
	type ProviderConfigConnection,
	type ProviderConfigConnectionSummary,
	ProviderConfigError,
	type ProviderConfigFeature,
	type ProviderConfigKind,
	type ProviderConfigProfile,
	type ProviderConfigProfileSummary,
	type ProviderConfigRole,
	type ProviderConfigRuntimeProfile,
	type ProviderConfigStore,
	profilePolicyViolation,
	roleForKind,
	runtimeProfile,
} from "@campus-agent/provider-config";
import { decryptProviderSecret, providerSecretRef } from "./provider-config-crypto.ts";
import type {
	ProviderConfigPublicationStatus,
	ProviderConfigPublisher,
} from "./provider-config-publisher.ts";

export interface ProviderConfigCompatibilityClient {
	check(input: {
		baseUrl: string;
		dimensions: number;
		model: string;
		provider: string;
		role: string;
		timeoutMs: number;
		transport: string;
	}): Promise<{ ok: boolean; reason: string }>;
}
export interface ProviderConfigService {
	activate(
		profileId: string,
		actor: ProviderConfigActor,
	): Promise<{ profile: ProviderConfigProfileSummary; runtime: ProviderConfigPublicationStatus }>;
	createConnection(
		payload: Record<string, unknown>,
		actor: ProviderConfigActor,
	): Promise<{ connection: ProviderConfigConnectionSummary }>;
	createProfile(
		payload: Record<string, unknown>,
		actor: ProviderConfigActor,
	): Promise<{ profile: ProviderConfigProfileSummary }>;
	listConnections(): Promise<{ connections: ProviderConfigConnectionSummary[] }>;
	listProfiles(): Promise<{
		profiles: ProviderConfigProfileSummary[];
		runtime: ProviderConfigPublicationStatus;
	}>;
	runtimeStatus(): Promise<ProviderConfigPublicationStatus>;
	updateConnection(
		id: string,
		payload: Record<string, unknown>,
		actor: ProviderConfigActor,
	): Promise<{ connection: ProviderConfigConnectionSummary }>;
	updateProfile(
		id: string,
		payload: Record<string, unknown>,
		actor: ProviderConfigActor,
	): Promise<{ profile: ProviderConfigProfileSummary }>;
	validate(
		id: string,
		actor: ProviderConfigActor,
	): Promise<{ profile: ProviderConfigProfileSummary }>;
	verifyReadiness(): Promise<void>;
}

export function createProviderConfigService(input: {
	compatibility: ProviderConfigCompatibilityClient;
	encryptionKey?: string;
	publisher: ProviderConfigPublisher;
	store: ProviderConfigStore;
}): ProviderConfigService {
	const { store, publisher } = input;
	return {
		async listConnections() {
			return { connections: (await store.listConnections()).map(connectionSummary) };
		},
		async listProfiles() {
			const current = await publisher.read();
			return {
				profiles: await profileSummaries(store, current?.projection.profiles ?? {}),
				runtime: current?.status ?? emptyStatus(),
			};
		},
		async runtimeStatus() {
			return (await publisher.read())?.status ?? emptyStatus();
		},
		async verifyReadiness() {
			await Promise.all([store.verifyReadiness(), publisher.verifyReadiness()]);
			await providerSecretRef("ops-web-readiness-probe", input.encryptionKey);
		},
		async createConnection(payload, actor) {
			const now = new Date().toISOString();
			const connection: ProviderConfigConnection = {
				apiKeySecret: await providerSecretRef(
					requiredString(payload.apiKey, "apiKey"),
					input.encryptionKey,
				),
				baseUrl: httpsUrl(payload.baseUrl),
				connectionId: id("provider_connection"),
				createdAt: now,
				createdBy: actor,
				featureConfig: objectValue(payload.featureConfig),
				features: features(payload.features),
				provider: provider(payload.provider),
				revision: 1,
				updatedAt: now,
				updatedBy: actor,
			};
			await store.saveConnection(connection);
			return { connection: connectionSummary(connection) };
		},
		async updateConnection(connectionId, payload, actor) {
			const current = await requireConnection(store, connectionId);
			await assertConnectionInactive(publisher, store, connectionId);
			const updated: ProviderConfigConnection = {
				...current,
				...(payload.apiKey === undefined
					? {}
					: {
							apiKeySecret: await providerSecretRef(
								requiredString(payload.apiKey, "apiKey"),
								input.encryptionKey,
							),
						}),
				...(payload.baseUrl === undefined ? {} : { baseUrl: httpsUrl(payload.baseUrl) }),
				...(payload.featureConfig === undefined
					? {}
					: { featureConfig: objectValue(payload.featureConfig) }),
				...(payload.features === undefined ? {} : { features: features(payload.features) }),
				...(payload.provider === undefined ? {} : { provider: provider(payload.provider) }),
				revision: current.revision + 1,
				updatedAt: new Date().toISOString(),
				updatedBy: actor,
			};
			await store.saveConnection(updated);
			return { connection: connectionSummary(updated) };
		},
		async createProfile(payload, actor) {
			const kind = providerKind(payload.kind);
			const role = providerRole(payload.role, kind);
			const connection = await requireConnection(
				store,
				requiredString(payload.connectionId, "connectionId"),
			);
			const now = new Date().toISOString();
			const profile: ProviderConfigProfile = {
				connectionId: connection.connectionId,
				createdAt: now,
				createdBy: actor,
				dimensions: dimensions(payload.dimensions, kind),
				kind,
				model: requiredString(payload.model, "model"),
				profileId: id("provider_profile"),
				revision: 1,
				role,
				status: "draft",
				timeoutMs: positiveInt(payload.timeoutMs, 30_000),
				transport: transport(payload.transport, kind),
				updatedAt: now,
				updatedBy: actor,
				validation: null,
			};
			assertPolicy(profile, connection);
			await store.saveProfile(profile);
			return { profile: profileSummary(profile, connection, false) };
		},
		async updateProfile(profileId, payload, actor) {
			const current = await requireProfile(store, profileId);
			await assertProfileInactive(publisher, profileId);
			const connectionId =
				payload.connectionId === undefined
					? current.connectionId
					: requiredString(payload.connectionId, "connectionId");
			const connection = await requireConnection(store, connectionId);
			const updated: ProviderConfigProfile = {
				...current,
				connectionId,
				...(payload.dimensions === undefined
					? {}
					: { dimensions: dimensions(payload.dimensions, current.kind) }),
				...(payload.model === undefined ? {} : { model: requiredString(payload.model, "model") }),
				...(payload.timeoutMs === undefined
					? {}
					: { timeoutMs: positiveInt(payload.timeoutMs, current.timeoutMs) }),
				...(payload.transport === undefined
					? {}
					: { transport: transport(payload.transport, current.kind) }),
				revision: current.revision + 1,
				status: "draft",
				updatedAt: new Date().toISOString(),
				updatedBy: actor,
				validation: null,
			};
			assertPolicy(updated, connection);
			await store.saveProfile(updated);
			return { profile: profileSummary(updated, connection, false) };
		},
		async validate(profileId, actor) {
			const current = await requireProfile(store, profileId);
			const connection = await requireConnection(store, current.connectionId);
			assertPolicy(current, connection);
			const result = await validateProvider(
				current,
				connection,
				await decryptProviderSecret(connection.apiKeySecret.ciphertext, input.encryptionKey),
			);
			const next: ProviderConfigProfile = {
				...current,
				revision: current.revision + 1,
				status: result.ok ? "validated" : "validation_failed",
				updatedAt: new Date().toISOString(),
				updatedBy: actor,
				validation: result,
			};
			await store.saveProfile(next);
			return { profile: profileSummary(next, connection, await isActive(publisher, profileId)) };
		},
		async activate(profileId, actor) {
			const profile = await requireProfile(store, profileId);
			const connection = await requireConnection(store, profile.connectionId);
			assertPolicy(profile, connection);
			if (!(profile.status === "validated" && profile.validation?.ok)) {
				throw new ProviderConfigError(
					"provider_profile_not_validated",
					"配置必须先通过验证。",
					409,
				);
			}
			if (
				profile.kind === "embedding" &&
				(profile.role === "rag_query_embedding" || profile.role === "index_embedding")
			) {
				const compatibility = await input.compatibility.check({
					baseUrl: connection.baseUrl,
					dimensions: profile.dimensions ?? 0,
					model: profile.model,
					provider: connection.provider,
					role: profile.role,
					timeoutMs: profile.timeoutMs,
					transport: profile.transport,
				});
				if (!compatibility.ok) {
					throw new ProviderConfigError(
						"embedding_profile_incompatible",
						compatibility.reason || "向量配置与当前索引不兼容。",
						409,
					);
				}
			}
			const current = await publisher.read();
			const profiles = { ...(current?.projection.profiles ?? {}) };
			profiles[profile.role] = runtimeProfile({
				apiKey: await decryptProviderSecret(
					connection.apiKeySecret.ciphertext,
					input.encryptionKey,
				),
				connection,
				profile,
			});
			const runtime = await publisher.publish(createProjection({ actor, profiles }));
			return { profile: profileSummary(profile, connection, true), runtime };
		},
	};
}

async function validateProvider(
	profile: ProviderConfigProfile,
	connection: ProviderConfigConnection,
	apiKey: string,
) {
	const url = `${connection.baseUrl.replace(/\/+$/u, "")}/${validationPath(profile, connection)}`;
	const body =
		profile.kind === "embedding"
			? {
					dimensions: profile.dimensions,
					input: "provider config validation",
					model: profile.model,
				}
			: profile.kind === "rerank"
				? {
						documents: ["provider config validation", "unrelated document"],
						model: profile.model,
						query: "provider config validation",
					}
				: profile.transport === "chat_completions"
					? {
							max_tokens: 8,
							messages: [{ content: "Reply OK", role: "user" }],
							model: profile.model,
						}
					: { input: "Reply OK", max_output_tokens: 8, model: profile.model };
	try {
		const response = await fetch(url, {
			body: JSON.stringify(body),
			headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
			method: "POST",
			signal: AbortSignal.timeout(profile.timeoutMs),
		});
		if (!response.ok) {
			return {
				errorCode: "provider_http_error",
				message: `模型服务返回 HTTP ${response.status}`,
				ok: false as const,
				status: "failed" as const,
				validatedAt: new Date().toISOString(),
			};
		}
		if (profile.kind === "prompt") {
			await response.body?.cancel();
			return {
				message: "模型服务验证通过。",
				ok: true as const,
				status: "passed" as const,
				validatedAt: new Date().toISOString(),
			};
		}
		const payload = (await response.json()) as {
			data?: Array<{ embedding?: unknown[] }>;
			results?: unknown[];
		};
		if (profile.kind === "rerank") {
			if (!(Array.isArray(payload.results) || Array.isArray(payload.data))) {
				return {
					errorCode: "rerank_response_invalid",
					message: "重排服务响应不兼容。",
					ok: false as const,
					status: "failed" as const,
					validatedAt: new Date().toISOString(),
				};
			}
			return {
				message: "模型服务验证通过。",
				ok: true as const,
				status: "passed" as const,
				validatedAt: new Date().toISOString(),
			};
		}
		const observed = payload.data?.[0]?.embedding?.length ?? 0;
		if (profile.kind === "embedding" && observed !== profile.dimensions) {
			return {
				errorCode: "embedding_dimensions_mismatch",
				message: `向量维度不一致：期望 ${profile.dimensions}，实际 ${observed}`,
				observedDimensions: observed,
				ok: false as const,
				status: "failed" as const,
				validatedAt: new Date().toISOString(),
			};
		}
		return {
			message: "模型服务验证通过。",
			observedDimensions: observed,
			ok: true as const,
			status: "passed" as const,
			validatedAt: new Date().toISOString(),
		};
	} catch (error) {
		return {
			errorCode: "provider_request_failed",
			message: error instanceof Error ? error.message : String(error),
			ok: false as const,
			status: "failed" as const,
			validatedAt: new Date().toISOString(),
		};
	}
}

async function profileSummaries(
	store: ProviderConfigStore,
	active: Record<string, ProviderConfigRuntimeProfile>,
): Promise<ProviderConfigProfileSummary[]> {
	const values: ProviderConfigProfileSummary[] = [];
	for (const profile of await store.listProfiles()) {
		values.push(
			profileSummary(
				profile,
				await requireConnection(store, profile.connectionId),
				active[profile.role]?.profile_id === profile.profileId,
			),
		);
	}
	return values;
}
function connectionSummary(value: ProviderConfigConnection): ProviderConfigConnectionSummary {
	return {
		baseUrl: value.baseUrl,
		connectionId: value.connectionId,
		createdAt: value.createdAt,
		featureConfig: structuredClone(value.featureConfig),
		features: [...value.features],
		provider: value.provider,
		revision: value.revision,
		secretConfigured: true,
		secretFingerprint: value.apiKeySecret.fingerprint,
		secretLast4: value.apiKeySecret.last4,
		updatedAt: value.updatedAt,
	};
}
function profileSummary(
	value: ProviderConfigProfile,
	connection: ProviderConfigConnection,
	active: boolean,
): ProviderConfigProfileSummary {
	return {
		active,
		baseUrl: connection.baseUrl,
		connectionId: value.connectionId,
		createdAt: value.createdAt,
		dimensions: value.dimensions,
		kind: value.kind,
		model: value.model,
		profileId: value.profileId,
		provider: connection.provider,
		revision: value.revision,
		role: value.role,
		status: value.status,
		timeoutMs: value.timeoutMs,
		transport: value.transport,
		updatedAt: value.updatedAt,
		validation: value.validation,
	};
}
function validationPath(
	profile: ProviderConfigProfile,
	connection: ProviderConfigConnection,
): string {
	if (profile.kind === "embedding") {
		return "embeddings";
	}
	if (profile.kind === "prompt") {
		return profile.transport === "chat_completions" ? "chat/completions" : "responses";
	}
	const rerank = connection.featureConfig.rerank;
	const configured =
		rerank && typeof rerank === "object" && !Array.isArray(rerank)
			? (rerank as Record<string, unknown>).path
			: undefined;
	const path =
		typeof configured === "string" && /^\/[A-Za-z0-9/_-]+$/u.test(configured)
			? configured
			: "/rerank";
	return path.replace(/^\/+/, "");
}
function emptyStatus(): ProviderConfigPublicationStatus {
	return {
		configured: false,
		digest: null,
		profiles: {},
		publicationId: null,
		publishedAt: null,
		publishedBy: null,
	};
}
async function requireConnection(store: ProviderConfigStore, id: string) {
	const value = await store.getConnection(id);
	if (!value) {
		throw new ProviderConfigError("provider_connection_not_found", "未找到模型服务连接。", 404);
	}
	return value;
}
async function requireProfile(store: ProviderConfigStore, id: string) {
	const value = await store.getProfile(id);
	if (!value) {
		throw new ProviderConfigError("provider_profile_not_found", "未找到模型配置。", 404);
	}
	return value;
}
async function isActive(publisher: ProviderConfigPublisher, id: string) {
	const current = await publisher.read();
	return Object.values(current?.projection.profiles ?? {}).some((item) => item.profile_id === id);
}
async function assertProfileInactive(publisher: ProviderConfigPublisher, id: string) {
	if (await isActive(publisher, id)) {
		throw new ProviderConfigError(
			"active_provider_profile_immutable",
			"当前生效配置不能原地修改，请创建新配置。",
			409,
		);
	}
}
async function assertConnectionInactive(
	publisher: ProviderConfigPublisher,
	store: ProviderConfigStore,
	id: string,
) {
	const active = await publisher.read();
	const profiles = await store.listProfiles();
	if (
		profiles.some(
			(item) =>
				item.connectionId === id &&
				active?.projection.profiles[item.role]?.profile_id === item.profileId,
		)
	) {
		throw new ProviderConfigError(
			"active_provider_connection_immutable",
			"当前生效连接不能原地修改，请创建新连接。",
			409,
		);
	}
}
function assertPolicy(profile: ProviderConfigProfile, connection: ProviderConfigConnection) {
	const error = profilePolicyViolation(profile, connection);
	if (error) {
		throw error;
	}
}
function id(prefix: string) {
	return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
function requiredString(value: unknown, field: string) {
	if (typeof value !== "string" || !value.trim()) {
		throw new ProviderConfigError("validation_failed", `${field} 不能为空。`, 422, { field });
	}
	return value.trim();
}
function httpsUrl(value: unknown) {
	const text = requiredString(value, "baseUrl").replace(/\/+$/u, "");
	try {
		if (new URL(text).protocol !== "https:") {
			throw new Error("provider URL must use HTTPS");
		}
	} catch {
		throw new ProviderConfigError("validation_failed", "baseUrl 必须是 HTTPS URL。", 422, {
			field: "baseUrl",
		});
	}
	return text;
}
function objectValue(value: unknown) {
	if (value === undefined) {
		return {};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ProviderConfigError("validation_failed", "featureConfig 必须是对象。", 422);
	}
	return structuredClone(value as Record<string, unknown>);
}
function features(value: unknown): ProviderConfigFeature[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((item) => item !== "prompt" && item !== "embedding" && item !== "rerank")
	) {
		throw new ProviderConfigError("validation_failed", "features 无效。", 422);
	}
	return [...new Set(value)] as ProviderConfigFeature[];
}
function provider(value: unknown) {
	const text = requiredString(value, "provider");
	if (!/^[a-z0-9][a-z0-9_-]{1,62}$/u.test(text)) {
		throw new ProviderConfigError("validation_failed", "provider 无效。", 422);
	}
	return text;
}
function providerKind(value: unknown): ProviderConfigKind {
	const text = requiredString(value, "kind");
	if (text !== "prompt" && text !== "embedding" && text !== "rerank") {
		throw new ProviderConfigError("validation_failed", "kind 无效。", 422);
	}
	return text;
}
function providerRole(value: unknown, kind: ProviderConfigKind): ProviderConfigRole {
	const role = roleForKind(requiredString(value, "role"), kind);
	if (!role) {
		throw new ProviderConfigError("validation_failed", "role 与 kind 不匹配。", 422);
	}
	return role;
}
function dimensions(value: unknown, kind: ProviderConfigKind) {
	if (kind !== "embedding") {
		return null;
	}
	return positiveInt(value, 0);
}
function positiveInt(value: unknown, fallback: number) {
	const number = value === undefined ? fallback : Number(value);
	if (!Number.isInteger(number) || number <= 0) {
		throw new ProviderConfigError("validation_failed", "数值必须是正整数。", 422);
	}
	return number;
}
function transport(value: unknown, kind: ProviderConfigKind) {
	const text = requiredString(value, "transport");
	const valid =
		kind === "prompt"
			? text === "responses" || text === "chat_completions"
			: kind === "embedding"
				? text === "embeddings" || text === "openai_embeddings"
				: text === "rerank" || text === "gitee_rerank";
	if (!valid) {
		throw new ProviderConfigError("validation_failed", "transport 与 kind 不匹配。", 422);
	}
	return text;
}
