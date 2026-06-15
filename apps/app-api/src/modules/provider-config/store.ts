import { and, desc, eq } from "drizzle-orm";

import type { Env } from "../../config";
import { type createRuntimeDatabase, createRuntimeDbGetter } from "../../db/runtime";
import { providerConfigProfiles } from "../../db/schema";
import type {
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigRole,
	ProviderConfigStatus,
} from "./types";

type RuntimeDbGetter = () => ReturnType<typeof createRuntimeDatabase>;

export interface ProviderConfigStore {
	getActiveByRole(role: ProviderConfigRole): Promise<ProviderConfigProfile | null>;
	getById(profileId: string): Promise<ProviderConfigProfile | null>;
	list(): Promise<ProviderConfigProfile[]>;
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
	const profiles = new Map<string, ProviderConfigProfile>();

	return {
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

function toProfile(row: typeof providerConfigProfiles.$inferSelect): ProviderConfigProfile {
	return {
		active: row.active,
		apiKeySecret: row.apiKeySecretJson,
		baseUrl: row.baseUrl,
		createdAt: row.createdAt.toISOString(),
		createdBy: row.createdByJson,
		dimensions: row.dimensions,
		kind: row.kind as ProviderConfigKind,
		model: row.model,
		profileId: row.profileId,
		provider: row.provider,
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

function writeProfileRow(
	profile: ProviderConfigProfile,
): typeof providerConfigProfiles.$inferInsert {
	return {
		active: profile.active,
		apiKeySecretJson: profile.apiKeySecret,
		baseUrl: profile.baseUrl,
		createdAt: toDate(profile.createdAt),
		createdByJson: profile.createdBy,
		dimensions: profile.dimensions,
		kind: profile.kind,
		model: profile.model,
		profileId: profile.profileId,
		provider: profile.provider,
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
