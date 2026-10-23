import { createNoticeDatabasePool } from "@campus-agent/notice-database";
import { createInternalPortalCollectionObjectStoreFromEnv } from "../../../src/object-store.ts";
import { loadInternalPortalEnv } from "./config.ts";
import portal from "../../../../../configs/sources/internal-portal.json" with { type: "json" };
import { migrateNoticeSources } from "./notice-source-migration.ts";
loadInternalPortalEnv(process.env);
const pool = createNoticeDatabasePool(process.env, { max: 1 });
const client = await pool.connect();
const objectStore = createInternalPortalCollectionObjectStoreFromEnv();
try {
 const lock = await client.query("SELECT pg_try_advisory_lock($1, $2) AS acquired", [1315928137, 1]);
 if (!lock.rows[0]?.acquired) throw new Error("another notice maintenance collection is already running");
 console.log(JSON.stringify(await migrateNoticeSources({ client, objectStore, portalHost: new URL(portal.portal_base_url).hostname })));
} finally {
 await client.query("SELECT pg_advisory_unlock($1, $2)", [1315928137, 1]);
 client.release();
 await pool.end();
 await objectStore.close?.();
}
