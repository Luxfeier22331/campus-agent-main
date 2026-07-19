import { defineConfig } from "drizzle-kit";

const schemaDatabaseUrl = process.env.APP_API_SCHEMA_DATABASE_URL?.trim();
if (!schemaDatabaseUrl) {
	throw new Error("APP_API_SCHEMA_DATABASE_URL is required for Drizzle schema commands.");
}

export default defineConfig({
	schema: "./src/db/schema/owned.ts",
	out: "./drizzle",
	dialect: "postgresql",
	migrations: {
		schema: "drizzle",
		table: "app_api_migrations",
	},
	dbCredentials: {
		url: schemaDatabaseUrl,
	},
	strict: true,
	verbose: true,
});
