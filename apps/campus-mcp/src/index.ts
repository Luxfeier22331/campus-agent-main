import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { campusMcpConfig, createCampusMcpServer } from "./server.js";

const transport = new StdioServerTransport();
await createCampusMcpServer(campusMcpConfig()).connect(transport);
