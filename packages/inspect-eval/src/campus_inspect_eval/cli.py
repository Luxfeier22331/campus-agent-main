import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Campus Inspect evaluation")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ["offline"]:
        command = commands.add_parser(name)
        command.add_argument("--log-dir", required=True)
        command.add_argument("--grader")
        command.add_argument("--input", required=True)
    report = commands.add_parser("report")
    report.add_argument("log")
    args = parser.parse_args()
    if args.command == "report":
        from .reports import report_log

        print(json.dumps(report_log(args.log), ensure_ascii=False, indent=2))
        return
    from inspect_ai import eval as inspect_eval

    from . import tasks

    task_args = {"grader": args.grader}
    if args.command == "offline":
        task_args["input"] = str(Path(args.input).resolve())
    logs = inspect_eval(
        f"{tasks.__file__}@{args.command}",
        task_args=task_args,
        model="mockllm/model",
        log_dir=args.log_dir,
        max_samples=1,
    )
    if any(log.status != "success" or any(s.error for s in log.samples or []) for log in logs):
        raise SystemExit(1)
