import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/owned.ts",
  out: "./drizzle",
  dialect: "postgresql",
  migrations: {
    schema: "drizzle",
    table: "app_api_migrations",
  },
  dbCredentials: {
    url:
      process.env.APP_API_MANAGEMENT_DATABASE_URL ??
      "postgres://postgres:postgres@127.0.0.1:5432/campus_agent",
  },
  strict: true,
  verbose: true,
});
