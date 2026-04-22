import { bootstrapSharedProductDatabase } from "./shared-product-database-bootstrap.mjs";

const result = await bootstrapSharedProductDatabase(process.env);

console.log(`auth_schema: ${result.authSchema}`);
console.log(`chat_schema: ${result.chatSchema}`);
console.log("applied_migrations:");
for (const migrationFile of result.migrationFiles) {
	console.log(`- ${migrationFile}`);
}
