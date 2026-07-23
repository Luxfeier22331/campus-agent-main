import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	out: "./drizzle",
	schema: "../../packages/domains/dining/src/schema.ts",
});
