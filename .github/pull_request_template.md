## Summary

- describe the logical change
- call out user-visible or operator-visible effects

## Verification

- [ ] `uv run --all-packages python -m unittest discover -s tests -t .`
- [ ] `pnpm web:typecheck`
- [ ] `pnpm web:test`
- [ ] `pnpm web:build`

## Risks

- list known follow-ups, rollout constraints, or unverified surfaces
