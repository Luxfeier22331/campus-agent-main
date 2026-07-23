import { postgresUrlFromEnv } from "../src/config.ts";
import { migrateDining } from "../src/migrate.ts";

await migrateDining(postgresUrlFromEnv());
console.log(JSON.stringify({ status: "dining_schema_ready" }));
