import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "../../packages/domains/dining/src/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	migrations: {
		schema: "drizzle",
		table: "ops_web_dining_migrations",
	},
	strict: true,
	verbose: true,
});
