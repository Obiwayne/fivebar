# Fivebar

Five checks before every push. Fivebar scans what your coding agent changes, sends problems back to the agent to fix, and blocks pushes with critical or high findings.

- **Scanners:** Opengrep 1.33.0 with Fivebar's own rules (`rules/fivebar-rules.yml`), Gitleaks 8.30.1 and OSV-Scanner 2.7.0. Each is downloaded from its GitHub release and checked against a pinned SHA-256.
- **Agent loop:** a Claude Code Stop hook scans the files the agent touched and hands findings back, up to 3 rounds.
- **MCP server:** `get_findings`, `get_finding`, `rescan`, `mark_fixed` and `get_loop` for the agent.
- **Push guard:** a git pre-push hook that scans the files and commits in a push.
- **Review gate:** scores the latest change 1 to 5 on security, correctness, readability, tests and maintainability, through your own `claude -p`.

Everything runs on your PC. Data lives in `%APPDATA%\Fivebar`.

## Run it

```bash
npm install
npm run build
node dist/cli/index.js tools install
npm run app
```

The CLI covers the same ground: `node dist/cli/index.js` lists the commands (`add`, `scan`, `findings`, `plan`, `connect`, `review`, `serve`).

## Develop

```bash
npm test
npm run typecheck
```

`docs/build-log/` has the build story and screenshots. `scripts/capture.mjs` re-shoots the screens from a plan in `docs/build-log/plans/`.
