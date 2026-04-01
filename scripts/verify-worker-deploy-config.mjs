import { readFile } from "node:fs/promises";

async function main() {
  const [, , configPath, ...requiredBindings] = process.argv;

  if (!configPath || requiredBindings.length === 0) {
    console.error(
      "Usage: node scripts/verify-worker-deploy-config.mjs <wrangler.json> <BINDING=service-name> [...]",
    );
    process.exit(1);
  }

  const rawConfig = await readFile(configPath, "utf8");
  const config = JSON.parse(rawConfig);
  const services = Array.isArray(config.services) ? config.services : [];

  for (const expectedBinding of requiredBindings) {
    const [binding, service] = expectedBinding.split("=", 2);
    const matched = services.some(
      (candidate) => candidate?.binding === binding && candidate?.service === service,
    );

    if (!binding || !service) {
      console.error(`Invalid binding specification: ${expectedBinding}`);
      process.exit(1);
    }

    if (!matched) {
      console.error(
        `Missing required service binding ${binding} -> ${service} in ${configPath}.`,
      );
      process.exit(1);
    }
  }
}

await main();
