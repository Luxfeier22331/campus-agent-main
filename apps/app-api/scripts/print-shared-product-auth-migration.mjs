import {
  compileBetterAuthMigrationSql,
  readSharedProductBootstrapEnv,
} from "./shared-product-database-bootstrap.mjs";

const env = readSharedProductBootstrapEnv(process.env);
const sql = await compileBetterAuthMigrationSql(env);

console.log(sql);
