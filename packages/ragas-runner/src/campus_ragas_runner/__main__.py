from __future__ import annotations

import sys

from campus_ragas_runner.agent_score_batch import main as agent_main
from campus_ragas_runner.score_batch import main as rag_main


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        raise SystemExit("usage: python -m campus_ragas_runner {rag|agent} [options]")
    command, *rest = args
    if command == "rag":
        return rag_main(rest)
    if command == "agent":
        return agent_main(rest)
    raise SystemExit(f"unknown campus_ragas_runner command: {command}")


if __name__ == "__main__":
    raise SystemExit(main())
