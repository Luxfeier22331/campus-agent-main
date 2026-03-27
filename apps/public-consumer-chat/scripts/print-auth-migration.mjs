import {
  compileBetterAuthMigrationSql,
  readBootstrapEnv,
} from "./lib/database-bootstrap.mjs";

const env = readBootstrapEnv(process.env);
const sql = await compileBetterAuthMigrationSql(env);

console.log(sql);
