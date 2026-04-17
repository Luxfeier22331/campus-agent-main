# Phase 1000 Plan Review

> 2026-04-13 update: 本评审里把 `课程地图` 视为可通过 same-doc evidence 完成回答的前提已失效。当前 runtime 已改为对课程地图 topology query fail-close。

**Verdict: BLOCK**

## Goal-backward summary

The current plan set is close, and its scope is disciplined:

- `1000-01` covers the source-contract drift without promoting `program_semester_facts` into a public serving surface.
- `1000-02` covers the curriculum structured-lookup boundary while keeping intent ownership in `rag-specialist` and evidence selection primitives in `retrieval-core`；当前有效结论是课程地图必须 fail-close，而不是继续补 same-doc answer shaping。
- `1000-03` covers the semester-facts projection loss and keeps rematerialization limited to `program_semester_facts`.
- No plan reopens unrelated corpus scope, serving-surface expansion, OCR redesign, or curriculum-wide rebuild work.

The blocking problem is that the plan set does **not** yet fully cover the phase goal for `trace split`, and every task still lacks a concrete completion condition.

## What passes review

- **Source-contract drift:** Covered by `1000-01` through canonical-vs-physical evidence identity and eval contract repair.
- **Course-map unsupported boundary:** Covered by `1000-02` through dedicated structured curriculum handling that preserves supported lookup sections but fail-closes `课程地图` topology queries.
- **Semester-facts projection loss:** Covered by `1000-03` through position-preserving table normalization and targeted regression fixtures.
- **Architecture / scope discipline:** Aligned with `docs/architecture/retrieval-serving-architecture.md` and ADR-0021. The plans keep `program_semester_facts` internal, keep selected scope at `curriculum_plan`, and do not move alias semantics into retrieval backend string rewriting.
- **Dependency graph:** Acyclic. `1000-04` correctly waits for the earlier repair plans before rerun closeout.

## Blocking issues

### 1. All four plans are structurally incomplete because every task is missing `<done>`

This affects:

- `1000-01` task blocks at `.planning/phases/1000-curriculum-semester-facts/1000-01-PLAN.md:49`, `:63`, `:77`
- `1000-02` task blocks at `.planning/phases/1000-curriculum-semester-facts/1000-02-PLAN.md:47`, `:60`, `:74`
- `1000-03` task blocks at `.planning/phases/1000-curriculum-semester-facts/1000-03-PLAN.md:46`, `:60`, `:74`
- `1000-04` task blocks at `.planning/phases/1000-curriculum-semester-facts/1000-04-PLAN.md:49`, `:62`, `:75`

Why this blocks the phase:

- The plans say what to change and how to verify commands, but they never define the explicit task completion state.
- For this phase, that is dangerous because several repairs are subtle contract changes. A passing unit test alone does not tell the executor whether the intended end state was achieved.

Required change:

- Add a `<done>` section to every task.
- Each `<done>` must state the final observable state, not just repeat the action. Example: canonical parent source id is present on semester-fact evidence, operator diagnostics render both identities, course-map runtime returns `no_answer` without retrieval/support evidence, only `program_semester_facts` rematerialization is required, live rerun artifact path is recorded.

### 2. `trace split` is not owned end-to-end; `1000-04` only covers the eval-side projection

`1000-04` currently owns only:

- `packages/evals/src/campus_evals/app_api_chat_runtime.py`
- `tests/evals/test_curriculum_live_benchmark.py`
- `tests/evals/test_runtime_observability.py`
- planning docs

But the current mirrored-trace behavior is also produced upstream:

- `packages/supervisor-core/src/campus_supervisor_core/response.py:41-78`
  - `candidate_count`, `retrieved_source_count`, and `citation_count` are all derived from the final evidence bundle.
- `apps/app-api/src/modules/request-observability.ts:296-379`
  - app-api persists counts and uses `sourceDocIds`, but does not own a separate raw-candidate source set.
- `apps/app-api/src/modules/operator-query/store.ts:598-643`
  - operator observability reads back counts and `sourceDocIds`; it does not expose raw retrieved candidates separately from final support.

Why this blocks the phase:

- The roadmap goal is not just "eval traces are split". It explicitly says **live eval and app-api observability** must expose raw retrieved candidates separately from final supporting evidence.
- Fixing only `packages/evals/src/campus_evals/app_api_chat_runtime.py:823-849` will make the evaluator less misleading, but operator-facing observability will still be unable to distinguish retrieval regression from answer-shaping regression.

Required change:

- Expand `1000-04` or add a small extra plan that explicitly owns the producer and persistence path for trace split.
- At minimum, assign ownership for:
  - `packages/contracts/src/campus_contracts/models.py` if new trace fields are needed in shared contracts / observability payloads
  - `packages/supervisor-core/src/campus_supervisor_core/response.py`
  - `apps/app-api/src/modules/request-observability.ts`
  - `apps/app-api/src/modules/operator-query/store.ts`
  - `apps/app-api/src/modules/operator-query/service.ts` if route shape changes
  - any required app-api schema / migration files if raw/support source sets must be stored, not just counted

### 3. Verification gates do not prove the app-api half of the trace split

`1000-04` Task 2 currently verifies only Python tests:

- `.planning/phases/1000-curriculum-semester-facts/1000-04-PLAN.md:63-72`

Why this blocks the phase:

- Once the missing app-api ownership is added, the current verify lane can still pass while the operator observability route remains unsplit or incorrectly projected.
- This phase goal includes app-api observability, so the verification bar must include app-api tests.

Required change:

- Extend `1000-04` verification with explicit JS/TS gates for the changed app-api surface.
- At minimum add:
  - `pnpm --dir apps/app-api exec vitest run test/request-observability.test.ts test/operator-query.route.test.ts test/supervisor-adapter.test.ts`
  - `pnpm --dir apps/app-api exec tsc --noEmit`

## Flags

### 1. `1000-03` is unnecessarily serialized

- `1000-03` depends only on `1000-01`, but is assigned `wave: 3` in `.planning/phases/1000-curriculum-semester-facts/1000-03-PLAN.md:5-7`.

Why this matters:

- It does not break correctness, but it serializes work that could run in parallel with `1000-02` after `1000-01` completes.

Suggested change:

- Move `1000-03` to wave 2, or document the hidden dependency if it really must wait for `1000-02`.

### 2. The live benchmark follow-up fixtures still encode the old semester source contract, but no task names that ownership explicitly

Current live benchmark helper fixtures still assume canonical curriculum doc ids:

- `tests/evals/test_curriculum_live_benchmark.py:70-120`
- `tests/evals/test_curriculum_live_benchmark.py:463-600`

Why this matters:

- `1000-01` changes the semester follow-up source contract.
- `1000-04` already touches this file for trace split, but no task explicitly says it must also align the live benchmark fixtures with the new canonical-vs-physical identity model.

Suggested change:

- Explicitly assign `tests/evals/test_curriculum_live_benchmark.py` source-contract fixture updates to `1000-01` or `1000-04`, instead of leaving that coupling implicit.

### 3. `1000-01` verifies diagnostics behavior without listing the diagnostics test file in ownership

- `1000-01` Task 3 verifies `tests.evals.test_context_diagnostics`, but `tests/evals/test_context_diagnostics.py` is not in `files_modified`.

Suggested change:

- Add that test file to `1000-01` ownership if diagnostics output is expected to change.

## Recommendation

Do **not** execute the current plan set as-is.

The curriculum-side repair scope is correct and sufficiently narrow, so this does **not** require reopening unrelated product or retrieval-serving scope. The right fix is to revise the existing plans as follows:

1. Add `<done>` blocks to every task in all four plans.
2. Expand `1000-04` to own the supervisor/app-api producer path for raw-vs-final trace split, not just the eval-side projection.
3. Add app-api verification gates for that trace split.
4. Make the live benchmark source-contract fixture update explicit.
5. Move `1000-03` to wave 2 unless there is a real hidden dependency.

With those changes, the plan set should be sufficient to fix the known curriculum rerun failures without reopening unrelated scope.
