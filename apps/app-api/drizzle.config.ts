import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/db/schema/managed.ts",
	out: "./drizzle",
	dialect: "postgresql",
	migrations: {
		schema: "drizzle",
		table: "app_api_migrations",
	},
	strict: true,
	verbose: true,
});
