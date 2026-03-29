import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/**/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.APP_API_MANAGEMENT_DATABASE_URL ??
      "postgres://postgres:postgres@127.0.0.1:5432/campus_agent",
  },
  strict: true,
  verbose: true,
});
