import {
	provisionMucWikiFederationClient,
	readMucWikiFederationClientProvisionInput,
} from "../../src/script-support/provisioning/provision-muc-wiki-federation-client-lib.ts";
import {
	createSharedProductPool,
	readSharedProductBootstrapEnv,
} from "../../src/script-support/shared-db/shared-product-database-bootstrap.ts";

async function main() {
	const input = readMucWikiFederationClientProvisionInput(process.env, process.argv.slice(2));
	const pool = createSharedProductPool(readSharedProductBootstrapEnv(process.env));

	try {
		const summary = await provisionMucWikiFederationClient(input, {
			executeSql(sql, params) {
				return pool.query(sql, params);
			},
		});
		console.log(JSON.stringify(summary, null, 2));
	} finally {
		await pool.end();
	}
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
