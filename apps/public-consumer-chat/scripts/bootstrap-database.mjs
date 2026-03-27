import { bootstrapDatabase } from "./lib/database-bootstrap.mjs";

const result = await bootstrapDatabase(process.env);

console.log(`auth_schema: ${result.authSchema}`);
console.log(`chat_schema: ${result.chatSchema}`);
console.log("applied_migrations:");
for (const migrationFile of result.migrationFiles) {
  console.log(`- ${migrationFile}`);
}
