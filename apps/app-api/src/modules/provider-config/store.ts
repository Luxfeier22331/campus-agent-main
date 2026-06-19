import { and, desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { providerConfigConnections, providerConfigProfiles } from "../../db/schema";
import type {
	ProviderConfigConnection,
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigRole,
	ProviderConfigStatus,
} from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface ProviderConfigStore {
	getConnectionById(connectionId: string): Promise<ProviderConfigConnection | null>;
	getActiveByRole(role: ProviderConfigRole): Promise<ProviderConfigProfile | null>;
	getById(profileId: string): Promise<ProviderConfigProfile | null>;
	listConnections(): Promise<ProviderConfigConnection[]>;
	list(): Promise<ProviderConfigProfile[]>;
	saveConnection(connection: ProviderConfigConnection): Promise<void>;
	save(profile: ProviderConfigProfile): Promise<void>;
	setActive(profile: ProviderConfigProfile): Promise<void>;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function toDate(value: string): Date {
	return new Date(value);
}

function sortProfiles(profiles: ProviderConfigProfile[]): ProviderConfigProfile[] {
	return profiles.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createInMemoryProviderConfigStore(): ProviderConfigStore {
	const connections = new Map<string, ProviderConfigConnection>();
	const profiles = new Map<string, ProviderConfigProfile>();

	return {
		async getConnectionById(connectionId) {
			const connection = connections.get(connectionId);
			return connection ? clone(connection) : null;
		},
		async getActiveByRole(role) {
			return (
				sortProfiles([...profiles.values()]).find(
					(profile) => profile.role === role && profile.active,
				) ?? null
			);
		},
		async getById(profileId) {
			const profile = profiles.get(profileId);
			return profile ? clone(profile) : null;
		},
		async list() {
			return sortProfiles([...profiles.values()]).map(clone);
		},
		async listConnections() {
			return [...connections.values()]
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.map(clone);
		},
		async saveConnection(connection) {
			connections.set(connection.connectionId, clone(connection));
		},
		async save(profile) {
			profiles.set(profile.profileId, clone(profile));
		},
		async setActive(profile) {
			for (const existing of profiles.values()) {
				if (existing.role === profile.role) {
					existing.active = false;
					if (existing.status === "active") {
						existing.status = "validated";
					}
				}
			}
			profiles.set(profile.profileId, clone({ ...profile, active: true, status: "active" }));
		},
	};
}

export function createPgProviderConfigStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
	} = {},
): ProviderConfigStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env, { consistency: "fresh" });
	return {
		async getConnectionById(connectionId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(providerConfigConnections)
				.where(eq(providerConfigConnections.connectionId, connectionId))
				.limit(1);
			return rows[0] ? toConnection(rows[0]) : null;
		},
		async getActiveByRole(role) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(providerConfigProfiles)
				.where(and(eq(providerConfigProfiles.role, role), eq(providerConfigProfiles.active, true)))
				.orderBy(desc(providerConfigProfiles.updatedAt))
				.limit(1);
			return rows[0] ? toProfile(rows[0]) : null;
		},
		async getById(profileId) {
			const db = await getDb();
			const rows = await db
				.select()
				.from(providerConfigProfiles)
				.where(eq(providerConfigProfiles.profileId, profileId))
				.limit(1);
			return rows[0] ? toProfile(rows[0]) : null;
		},
		async list() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(providerConfigProfiles)
				.orderBy(desc(providerConfigProfiles.updatedAt));
			return rows.map(toProfile);
		},
		async listConnections() {
			const db = await getDb();
			const rows = await db
				.select()
				.from(providerConfigConnections)
				.orderBy(desc(providerConfigConnections.updatedAt));
			return rows.map(toConnection);
		},
		async saveConnection(connection) {
			const db = await getDb();
			await db
				.insert(providerConfigConnections)
				.values(writeConnectionRow(connection))
				.onConflictDoUpdate({
					set: writeConnectionRow(connection),
					target: providerConfigConnections.connectionId,
				});
		},
		async save(profile) {
			const db = await getDb();
			await db
				.insert(providerConfigProfiles)
				.values(writeProfileRow(profile))
				.onConflictDoUpdate({
					set: writeProfileRow(profile),
					target: providerConfigProfiles.profileId,
				});
		},
		async setActive(profile) {
			const db = await getDb();
			await db.transaction(async (tx) => {
				await tx
					.update(providerConfigProfiles)
					.set({ active: false, status: "validated" })
					.where(
						and(
							eq(providerConfigProfiles.role, profile.role),
							eq(providerConfigProfiles.active, true),
						),
					);
				await tx
					.insert(providerConfigProfiles)
					.values(writeProfileRow({ ...profile, active: true, status: "active" }))
					.onConflictDoUpdate({
						set: writeProfileRow({ ...profile, active: true, status: "active" }),
						target: providerConfigProfiles.profileId,
					});
			});
		},
	};
}

function toConnection(
	row: typeof providerConfigConnections.$inferSelect,
): ProviderConfigConnection {
	return {
		apiKeySecret: row.apiKeySecretJson,
		baseUrl: row.baseUrl,
		capabilities: row.capabilitiesJson,
		capabilityConfig: row.capabilityConfigJson,
		connectionId: row.connectionId,
		createdAt: row.createdAt.toISOString(),
		createdBy: row.createdByJson,
		provider: row.provider,
		revision: row.revision,
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: row.updatedByJson,
	};
}

function toProfile(row: typeof providerConfigProfiles.$inferSelect): ProviderConfigProfile {
	return {
		active: row.active,
		apiKeySecret: row.apiKeySecretJson ?? undefined,
		baseUrl: row.baseUrl ?? undefined,
		connectionId: row.connectionId,
		createdAt: row.createdAt.toISOString(),
		createdBy: row.createdByJson,
		dimensions: row.dimensions,
		kind: row.kind as ProviderConfigKind,
		model: row.model,
		profileId: row.profileId,
		provider: row.provider ?? undefined,
		revision: row.revision,
		role: row.role as ProviderConfigRole,
		status: row.status as ProviderConfigStatus,
		timeoutMs: row.timeoutMs,
		transport: row.transport,
		updatedAt: row.updatedAt.toISOString(),
		updatedBy: row.updatedByJson,
		validation: row.validationJson,
	};
}

function writeConnectionRow(
	connection: ProviderConfigConnection,
): typeof providerConfigConnections.$inferInsert {
	return {
		apiKeySecretJson: connection.apiKeySecret,
		baseUrl: connection.baseUrl,
		capabilitiesJson: connection.capabilities,
		capabilityConfigJson: connection.capabilityConfig,
		connectionId: connection.connectionId,
		createdAt: toDate(connection.createdAt),
		createdByJson: connection.createdBy,
		provider: connection.provider,
		revision: connection.revision,
		updatedAt: toDate(connection.updatedAt),
		updatedByJson: connection.updatedBy,
	};
}

function writeProfileRow(
	profile: ProviderConfigProfile,
): typeof providerConfigProfiles.$inferInsert {
	return {
		active: profile.active,
		apiKeySecretJson: profile.apiKeySecret ?? null,
		baseUrl: profile.baseUrl ?? "",
		connectionId: profile.connectionId,
		createdAt: toDate(profile.createdAt),
		createdByJson: profile.createdBy,
		dimensions: profile.dimensions,
		kind: profile.kind,
		model: profile.model,
		profileId: profile.profileId,
		provider: profile.provider ?? "",
		revision: profile.revision,
		role: profile.role,
		status: profile.status,
		timeoutMs: profile.timeoutMs,
		transport: profile.transport,
		updatedAt: toDate(profile.updatedAt),
		updatedByJson: profile.updatedBy,
		validationJson: profile.validation,
	};
}
