# Reality Check (2026-02-19)

| Claim | Evidence | Status | Next Action |
|---|---|---|---|
| Live ALB is reachable | `GET /` and `GET /api/health` return `200` from `http://workflow-orc-demo-alb-1577468805.us-east-1.elb.amazonaws.com` | Verified | Keep `scripts/cloud-smoke.sh` in deploy checks |
| Live system supports creating and triggering workflows | API supports `POST /api/workflows` and `POST /api/workflows/:id/trigger`; UI now exposes both actions | Verified | Keep seed workflow script for quick demos |
| Dashboard always shows activity by default | Live environment may contain zero workflows/runs at startup | Partial | Run `npm run demo:live-seed` before demos |
| Runtime state is durable | Control-plane and worker use Postgres-backed store (`control-plane/src/store/postgresStore.ts`) | Verified | Keep migration step mandatory in runbooks |
| Authentication is production identity | Static token map (`AUTH_TOKENS`) is used in current runtime | Partial | Replace static token auth with managed identity in future phase |
| External API keys are required for live demo usage | UI/API flows use static bearer tokens (`admin-token`, `operator-token`, `viewer-token`); no third-party API key dependency | Verified | Keep README explicit about token input requirements |
| Runtime docs contain unresolved TODO/FIXME placeholders | Cross-repo scan on `2026-02-19` found no unresolved TODO/FIXME markers in runtime code/docs | Verified | Keep placeholder scans in release checklist |
