from __future__ import annotations

import os
from dataclasses import dataclass

from campus_shared import load_repo_env

from campus_supervisor_agent_worker.agent_dispatch import dispatch_agent_request
from campus_supervisor_agent_worker.app import create_bridge_app
from campus_supervisor_agent_worker.asgi import SupervisorBridgeAsgiApp
from campus_supervisor_agent_worker.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class BridgeServerSettings:
    host: str = "127.0.0.1"
    port: int = 27052

    @classmethod
    def from_env(cls) -> BridgeServerSettings:
        return cls(
            host=os.getenv("SUPERVISOR_AGENT_WORKER_HOST", "127.0.0.1"),
            port=int(os.getenv("SUPERVISOR_AGENT_WORKER_PORT", "27052")),
        )


def serve(
    *,
    host: str | None = None,
    port: int | None = None,
    settings: ApiSettings | None = None,
    agent_handler=dispatch_agent_request,
) -> None:
    import uvicorn

    runtime_settings = settings or ApiSettings.from_env()
    server_settings = BridgeServerSettings.from_env()
    resolved_host = host or server_settings.host
    resolved_port = port or server_settings.port
    app = create_bridge_app(settings=runtime_settings, agent_handler=agent_handler)
    asgi_app = SupervisorBridgeAsgiApp(
        app,
        max_workers=runtime_settings.bridge_worker_threads,
    )
    print(
        f"campus-supervisor-agent-worker dev server listening on "
        f"http://{resolved_host}:{resolved_port}"
    )
    try:
        uvicorn.run(
            asgi_app,
            host=resolved_host,
            port=resolved_port,
            log_level="info",
            lifespan="on",
        )
    except KeyboardInterrupt:
        pass
    finally:
        asgi_app.close()
        app.close()


def main() -> None:
    load_repo_env()
    serve()


if __name__ == "__main__":
    main()
