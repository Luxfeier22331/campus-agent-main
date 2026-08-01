import { createServer } from "node:http";

const port = 27031;

const server = createServer((request, response) => {
	request.resume();
	response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
	response.end(
		JSON.stringify({
			method: request.method ?? "GET",
			path: new URL(request.url ?? "/", "http://127.0.0.1").pathname,
			service: "app-api-e2e-stub",
		}),
	);
});

server.listen(port, "127.0.0.1");
