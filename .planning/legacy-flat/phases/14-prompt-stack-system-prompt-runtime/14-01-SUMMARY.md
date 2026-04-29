# 14-01 Summary

## Outcome

- `apps/supervisor-api` 现在已显式拥有 product-path prompt runtime seam，而不再只暴露泛化的 runtime/model 标签。
- repo-default prompt stack 的第一条代码真相已经落地：
  - `repo_global_developer_invariants`
  - `package_role_prompt`
  - `trusted_task_packet`
  - `untrusted_user_input`
  - `untrusted_evidence_packet`
- `packages/shared` 现在提供 repo-global developer invariants 与 canonical prompt payload serialization helper。
- `apps/supervisor-api/src/campus_supervisor_api/prompt_stack.py` 已把 supervisor/rag prompt packet 装配成 machine-checkable stack assembly，并强制 user/evidence 不进入 developer zone。
- `readyz` 与 `create_app().runtime` 现在都会显式暴露 prompt runtime config：
  - provider
  - developer invariants id/version
  - strict structured outputs 开关
  - supervisor/specialist prompt model

## What Changed

- 新增：
  - `apps/supervisor-api/src/campus_supervisor_api/prompt_stack.py`
  - `tests/api/test_supervisor_api_prompt_stack.py`
- 更新：
  - `packages/shared/src/campus_shared/prompt_runtime.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `apps/supervisor-api/src/campus_supervisor_api/settings.py`
  - `apps/supervisor-api/src/campus_supervisor_api/app.py`
  - `apps/supervisor-api/src/campus_supervisor_api/api.py`
  - `tests/api/test_supervisor_api.py`
  - `apps/supervisor-api/README.md`
  - `docs/architecture/prompt-and-instruction-architecture.md`
  - `docs/architecture/execution-and-agents-architecture.md`

## Verification

- `uv run --all-packages python -m unittest tests.api.test_supervisor_api tests.api.test_supervisor_api_prompt_stack tests.supervisor.test_supervisor_prompting tests.specialist.test_rag_prompting`
  - `Ran 36 tests in 0.009s`
  - `OK`

## Next

- `14-02` 进入实现期：把当前已冻结的 stack assembly 接到 provider-backed strict structured output executor，并产出真实 `PromptTrace` 元数据。
