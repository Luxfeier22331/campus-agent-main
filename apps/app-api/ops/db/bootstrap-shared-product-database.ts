import { bootstrapSharedProductDatabase } from "../../src/script-support/shared-db/shared-product-database-bootstrap.ts";

async function main(): Promise<void> {
	const result = await bootstrapSharedProductDatabase(process.env);

	console.log(`auth_schema: ${result.authSchema}`);
	console.log(`chat_schema: ${result.chatSchema}`);
	console.log("applied_schema_files:");
	for (const schemaFile of result.schemaFiles) {
		console.log(`- ${schemaFile}`);
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
