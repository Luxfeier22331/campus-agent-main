import { randomUUID } from "node:crypto";

import type { DiningOpsActor, DiningSourceObservation } from "@campus-agent/dining/domain";
import type { Pool, PoolClient } from "pg";

export type DiningQuery = Pick<Pool, "query">;
export type DiningPool = Pick<Pool, "connect" | "query">;

export class DiningStoreNotFoundError extends Error {
	readonly kind: string;

	constructor(kind: string) {
		super(`Dining ${kind} was not found.`);
		this.kind = kind;
	}
}

export class DiningStoreValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DiningStoreValidationError";
	}
}

export async function withDiningTransaction<T>(
	pool: Pick<Pool, "connect">,
	work: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await work(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}

export async function writeDiningEvent(
	client: Pick<PoolClient, "query">,
	actor: DiningOpsActor,
	action: string,
	objectKind: string,
	objectId: string,
	summary: Record<string, unknown>,
): Promise<void> {
	await client.query("INSERT INTO dining.operation_events VALUES($1,$2,$3,$4,$5,$6,now())", [
		`dining_event:${randomUUID()}`,
		action,
		actor.principalId,
		objectKind,
		objectId,
		JSON.stringify(summary),
	]);
}

export function diningRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Expected object from Dining database.");
	}
	return value as Record<string, unknown>;
}

export function diningStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

export function diningDateIso(value: unknown): string {
	const date = value instanceof Date ? value : new Date(String(value));
	if (!Number.isFinite(date.getTime())) {
		throw new Error("Invalid Dining timestamp.");
	}
	return date.toISOString();
}

export function diningDateIsoOrNull(value: unknown): string | null {
	return value === null || value === undefined ? null : diningDateIso(value);
}

export function diningSourceType(value: unknown): DiningSourceObservation["sourceType"] {
	if (value === "feishu_catalog" || value === "feishu_review") {
		return value;
	}
	throw new Error("Invalid Dining source type.");
}

export function diningObservationStatus(value: unknown): DiningSourceObservation["status"] {
	if (value === "accepted" || value === "blocked" || value === "observed") {
		return value;
	}
	throw new Error("Invalid Dining observation status.");
}

export function diningTargetKind(value: unknown): DiningSourceObservation["targetKind"] {
	if (["campus", "hall", "menu_item", "menu_offering", "review", "stall"].includes(String(value))) {
		return value as DiningSourceObservation["targetKind"];
	}
	throw new Error("Invalid Dining target kind.");
}
