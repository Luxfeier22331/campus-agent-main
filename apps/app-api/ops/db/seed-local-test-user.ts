import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { hashAppPassword } from "../../src/modules/auth/auth.ts";
import {
	createAppApiDatabasePool,
	readAppApiDatabaseEnv,
} from "../../src/script-support/shared-db/database.ts";

export const LOCAL_TEST_USER = {
	email: "test@muc.edu.cn",
	name: "本地测试用户",
	password: "password123",
} as const;

const LOCAL_TEST_USER_ID = "local_test_user";
const LOCAL_TEST_ACCOUNT_ID = "local_test_user_credential";
const LOCAL_DATABASE_NAME = /^campus_agent_wt_[0-9]+_[a-f0-9]{8}$/u;

export function assertLocalTestUserDatabaseUrl(value: string): void {
	const url = new URL(value);
	const databaseName = decodeURIComponent(url.pathname.slice(1));
	if (url.hostname !== "127.0.0.1" || !LOCAL_DATABASE_NAME.test(databaseName)) {
		throw new Error("The fixed test user can only be seeded into an isolated local database.");
	}
}

export async function seedLocalTestUser(
	envOverrides: NodeJS.ProcessEnv = process.env,
): Promise<{ email: string; initialized: true }> {
	const env = readAppApiDatabaseEnv(envOverrides);
	assertLocalTestUserDatabaseUrl(env.databaseUrl);
	const pool = createAppApiDatabasePool(env);
	const passwordHash = await hashAppPassword(LOCAL_TEST_USER.password);
	try {
		await pool.query("BEGIN");
		try {
			const users = await pool.query<{ id: string }>(
				`insert into app_auth."user"
					("id", "name", "email", "emailVerified", "banned", "banReason", "banExpires",
					 "passwordChangeRequired", "temporaryPasswordExpiresAt", "role", "createdAt", "updatedAt")
				 values ($1, $2, $3, true, false, null, null, false, null, 'user', now(), now())
				 on conflict ("email") do update set
					"name" = excluded."name",
					"emailVerified" = true,
					"banned" = false,
					"banReason" = null,
					"banExpires" = null,
					"passwordChangeRequired" = false,
					"temporaryPasswordExpiresAt" = null,
					"role" = 'user',
					"updatedAt" = now()
				 returning "id"`,
				[LOCAL_TEST_USER_ID, LOCAL_TEST_USER.name, LOCAL_TEST_USER.email],
			);
			const userId = users.rows[0]?.id;
			if (!userId) {
				throw new Error("The local test user was not returned after initialization.");
			}

			const credentials = await pool.query(
				`update app_auth."account"
				 set "accountId" = $1, "password" = $2, "updatedAt" = now()
				 where "userId" = $1 and "providerId" = 'credential'`,
				[userId, passwordHash],
			);
			if (credentials.rowCount === 0) {
				await pool.query(
					`insert into app_auth."account"
						("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
					 values ($1, $2, 'credential', $2, $3, now(), now())
					 on conflict ("id") do update set
						"accountId" = excluded."accountId",
						"providerId" = excluded."providerId",
						"userId" = excluded."userId",
						"password" = excluded."password",
						"updatedAt" = now()`,
					[LOCAL_TEST_ACCOUNT_ID, userId, passwordHash],
				);
			}
			await pool.query("COMMIT");
		} catch (error) {
			await pool.query("ROLLBACK");
			throw error;
		}
		return { email: LOCAL_TEST_USER.email, initialized: true };
	} finally {
		await pool.end();
	}
}

async function main(): Promise<void> {
	console.log(JSON.stringify(await seedLocalTestUser()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
