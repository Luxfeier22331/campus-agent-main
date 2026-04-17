import { Client } from "pg";

import { createApp } from "../src/app";
import {
  buildSmokeIdentityProvisionRuntimeEnv,
  provisionSmokeIdentity,
  readSmokeIdentityProvisionInput,
} from "./provision-smoke-identity-lib.mjs";

function resolveSslConfig(databaseSslMode: string) {
  return databaseSslMode === "disable"
    ? false
    : {
        rejectUnauthorized: false as const,
      };
}

const databaseSslMode =
  process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
    ? "disable"
    : process.env.APP_API_DATABASE_SSLMODE?.trim() === "prefer"
      ? "prefer"
      : "require";

async function main() {
  const input = readSmokeIdentityProvisionInput(process.argv.slice(2), process.env);
  const runtimeEnv = buildSmokeIdentityProvisionRuntimeEnv(input);

  const summary = await provisionSmokeIdentity(
    {
      ...input,
      runtimeEnv,
    },
    {
      appFetch(request) {
        const app = createApp(runtimeEnv);

        return app.fetch(request);
      },
      async executeSql(sql, params) {
        const client = new Client({
          connectionString: process.env.APP_API_MANAGEMENT_DATABASE_URL,
          ssl: resolveSslConfig(databaseSslMode),
        });

        await client.connect();
        try {
          return await client.query(sql, params);
        } finally {
          await client.end();
        }
      },
    },
  );

  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
