import {
	createNoticeDatabasePool,
	isNoticeLockSkipped,
	withNoticeMaintenanceLock,
} from "@campus-agent/notice-database";
import { createInternalPortalCollectionObjectStoreFromEnv } from "../../../src/object-store.ts";
import { loadInternalPortalEnv } from "./config.ts";
import portal from "../../../../../configs/sources/internal-portal.json" with { type: "json" };
import { migrateNoticeSources } from "./notice-source-migration.ts";
loadInternalPortalEnv(process.env);
const pool = createNoticeDatabasePool(process.env, { max: 1 });
const client = await pool.connect();
const objectStore = createInternalPortalCollectionObjectStoreFromEnv();
try {
 const result = await withNoticeMaintenanceLock(client, () => migrateNoticeSources({ client, objectStore, portalHost: new URL(portal.portal_base_url).hostname }));
 if (isNoticeLockSkipped(result)) throw new Error("another notice maintenance collection is already running");
 console.log(JSON.stringify(result));
} finally {
 client.release();
 await pool.end();
 await objectStore.close?.();
}
