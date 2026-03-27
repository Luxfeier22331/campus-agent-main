import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import appServer from "../dist/server/server.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const clientRoot = join(appRoot, "dist", "client");
const host = process.env.HOST ?? process.env.PUBLIC_CONSUMER_CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? process.env.PUBLIC_CONSUMER_CHAT_PORT ?? "3000");

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function toWebRequest(request, origin) {
  const url = new URL(request.url ?? "/", origin);
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : Readable.toWeb(request),
    duplex: "half",
  });
}

function writeHeaders(response, reply) {
  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "set-cookie" && setCookie.length > 0) {
      continue;
    }
    reply.setHeader(key, value);
  }

  if (setCookie.length > 0) {
    reply.setHeader("set-cookie", setCookie);
  }
}

async function tryServeStatic(pathname, reply) {
  const normalizedPath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const resolvedPath = join(
    clientRoot,
    normalizedPath === "/" ? "index.html" : normalizedPath.slice(1),
  );

  try {
    await access(resolvedPath);
  } catch {
    return false;
  }

  reply.statusCode = 200;
  reply.setHeader(
    "content-type",
    MIME_TYPES.get(extname(resolvedPath)) ?? "application/octet-stream",
  );
  createReadStream(resolvedPath).pipe(reply);
  return true;
}

const server = createServer(async (request, reply) => {
  try {
    const origin = `http://${host}:${port}`;
    const url = new URL(request.url ?? "/", origin);

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      (url.pathname.startsWith("/assets/") || extname(url.pathname) !== "")
    ) {
      const served = await tryServeStatic(url.pathname, reply);
      if (served) {
        return;
      }
    }

    const response = await appServer.fetch(toWebRequest(request, origin));

    reply.statusCode = response.status;
    writeHeaders(response, reply);

    if (!response.body) {
      reply.end();
      return;
    }

    Readable.fromWeb(response.body).pipe(reply);
  } catch (error) {
    reply.statusCode = 500;
    reply.setHeader("content-type", "text/plain; charset=utf-8");
    reply.end(
      error instanceof Error
        ? error.stack ?? error.message
        : "public-consumer-chat server failed",
    );
  }
});

server.listen(port, host, () => {
  console.log(`public-consumer-chat listening on http://${host}:${port}`);
});
