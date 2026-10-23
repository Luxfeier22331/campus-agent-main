import type { Pool, PoolClient } from "pg";
import {
	DiningStoreConflictError,
	DiningStoreNotFoundError,
	DiningStoreUnavailableError,
	DiningStoreValidationError,
} from "./dining-store-errors.ts";

export type DiningDatabase = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export type DiningDatabasePool = Pick<Pool, "connect" | "query">;

export async function diningTransaction<T>(
	pool: Pick<Pool, "connect">,
	callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		const result = await callback(client);
		await client.query("commit");
		return result;
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
	}
}

export async function withDiningStoreErrors<T>(callback: () => Promise<T>): Promise<T> {
	try {
		return await callback();
	} catch (error) {
		if (
			error instanceof DiningStoreConflictError ||
			error instanceof DiningStoreNotFoundError ||
			error instanceof DiningStoreUnavailableError ||
			error instanceof DiningStoreValidationError
		) {
			throw error;
		}
		throw new DiningStoreUnavailableError("食堂内容数据库请求失败。", { cause: error });
	}
}

export function isoDate(value: unknown): string {
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.valueOf())) {
		throw new DiningStoreUnavailableError("数据库时间字段无效。");
	}
	return date.toISOString();
}

export function nullableIsoDate(value: unknown): string | null {
	return value === null || value === undefined ? null : isoDate(value);
}

export function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value) {
		throw new DiningStoreUnavailableError(`数据库中的 ${field} 无效。`);
	}
	return value;
}

export function nullableString(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}
