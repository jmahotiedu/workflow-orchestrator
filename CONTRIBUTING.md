# Contributing to workflow-orchestrator-clean-verify

## Workflow

1. Create a branch per issue or improvement.
2. Keep API/worker/ui changes isolated where possible.
3. Add or update tests and docs before opening the PR.
4. Include verification output in the PR description.

## Local Validation

```bash
npm run lint
npm run test
npm run build
npm run bench
```

## Pull Request Checklist

- [ ] State machine, retry, and recovery behaviors remain covered.
- [ ] Dashboard/API contract changes include screenshots or samples.
- [ ] Docs/postmortems/runbooks updated when operational behavior shifts.

## Commit Discipline

- Use conventional commit messages.
- One logical concern per commit.
- Keep generated artifacts out of commits unless intentional.