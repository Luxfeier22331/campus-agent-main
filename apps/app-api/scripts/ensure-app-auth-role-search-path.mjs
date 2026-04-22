import { Pool } from "pg";

import {
	ensureBetterAuthRoleSearchPath,
	readSharedProductBootstrapEnv,
	verifyBetterAuthPoolSearchPath,
} from "./shared-product-database-bootstrap.mjs";

const env = readSharedProductBootstrapEnv(process.env);
const pool = new Pool({
	connectionString: env.databaseUrl,
	ssl:
		env.databaseSslMode === "disable"
			? false
			: {
					rejectUnauthorized: false,
				},
});

try {
	const changed = await ensureBetterAuthRoleSearchPath(pool, env);
	await verifyBetterAuthPoolSearchPath(env);
	console.log(`role_search_path_updated: ${changed ? "yes" : "no"}`);
	console.log(`auth_schema: ${env.authSchema}`);
} finally {
	await pool.end();
}
