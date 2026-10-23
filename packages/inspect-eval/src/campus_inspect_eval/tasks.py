from importlib.metadata import version

from inspect_ai import Task, task

from campus_inspect_eval.dataset import saved_dataset
from campus_inspect_eval.scorers import process_contract, semantic_quality
from campus_inspect_eval.solvers import saved_result


def scorers(grader):
    return [process_contract(), *([semantic_quality(grader)] if grader else [])]


@task
def offline(input: str, grader: str | None = None):
    return Task(
        dataset=saved_dataset(input),
        solver=saved_result(),
        scorer=scorers(grader),
        metadata={"inspect_version": version("inspect-ai"), "mode": "offline"},
        fail_on_error=False,
    )
