from collections import Counter, defaultdict

from inspect_ai.log import read_eval_log


def summary(counts):
    scored = counts["scored_pass"] + counts["scored_fail"]
    eligible = scored + counts["unscored_missing_input"] + counts["execution_error"]
    return {
        "counts": dict(counts),
        "pass_rate": counts["scored_pass"] / scored if scored else None,
        "coverage": scored / eligible if eligible else None,
    }


def report_log(path):
    log = read_eval_log(path)
    samples = []
    counts = Counter()
    families = defaultdict(Counter)
    dimensions = defaultdict(Counter)
    for sample in log.samples or []:
        findings = []
        case = (sample.store or {}).get("case", {})
        session = (sample.store or {}).get("session", {})
        family = case.get("case_family", "unspecified")
        for name, score in (sample.scores or {}).items():
            for check in (score.metadata or {}).get("checks", []):
                counts[check["status"]] += 1
                families[family][check["status"]] += 1
                dimensions[check["name"]][check["status"]] += 1
                findings.append({"scorer": name, **check})
        if sample.error:
            counts["execution_error"] += 1
            families[family]["execution_error"] += 1
        turns = []
        for turn in session.get("turns", []):
            entries = [*turn.get("stages", []), *turn.get("tools", [])]
            turns.append(
                {
                    "turn_id": turn["turn_id"],
                    "request_id": turn.get("request_id"),
                    "status": turn.get("status"),
                    "failure_code": turn.get("failure_code"),
                    "timing": turn.get("timing", {}),
                    "coverage": turn.get("coverage", {}),
                    "tool_calls": dict(
                        Counter(t.get("tool_name", "unknown") for t in turn.get("tools", []))
                    ),
                    "steps": [
                        {
                            k: e[k]
                            for k in (
                                "step_id",
                                "parent_step_id",
                                "invocation_id",
                                "stage_kind",
                                "operation",
                                "status",
                                "duration_ms",
                                "attempts",
                            )
                            if k in e
                        }
                        for e in entries
                    ],
                }
            )
        samples.append(
            {
                "case_id": sample.id,
                "case_family": family,
                "epoch": sample.epoch,
                "execution_error": bool(sample.error),
                "findings": findings,
                "turns": turns,
            }
        )
    return {
        "status": log.status,
        **summary(counts),
        "by_family": {k: summary(v) for k, v in families.items()},
        "by_dimension": {k: summary(v) for k, v in dimensions.items()},
        "samples": samples,
    }
