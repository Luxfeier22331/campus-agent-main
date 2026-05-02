from __future__ import annotations

import argparse
import os
from collections.abc import Sequence
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Serve a minimal S3-compatible smoke endpoint.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=27061)
    return parser


class SmokeS3Handler(BaseHTTPRequestHandler):
    server_version = "SmokeS3/1.0"

    def do_HEAD(self) -> None:
        if _bucket_from_path(self.path) == _bucket_name():
            self.send_response(HTTPStatus.OK)
            self.end_headers()
            return
        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()

    def do_GET(self) -> None:
        bucket, key = _bucket_and_key_from_path(self.path)
        if bucket != _bucket_name() or not key:
            self.send_response(HTTPStatus.NOT_FOUND)
            self.end_headers()
            return
        body = os.getenv("SMOKE_S3_RESPONSE_BODY", "# smoke object\n").encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", "text/markdown; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def _bucket_name() -> str:
    return os.getenv("SMOKE_S3_BUCKET", "campus-rag-derived").strip() or "campus-rag-derived"


def _bucket_from_path(path: str) -> str:
    return _bucket_and_key_from_path(path)[0]


def _bucket_and_key_from_path(path: str) -> tuple[str, str]:
    parsed_path = unquote(urlparse(path).path).strip("/")
    if not parsed_path:
        return "", ""
    bucket, _, key = parsed_path.partition("/")
    return bucket, key


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    server = ThreadingHTTPServer((args.host, args.port), SmokeS3Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
