# Building Fivebar: a security loop for coding agents

Draft for the RepoQuarry blog and builds page. Not published. Screenshots and GIFs live in `docs/build-log/img/`.

---

Coding agents write a lot of code fast. Most of the time nobody reads all of the diff before it gets pushed. Fivebar sits between the agent and `git push`, scans every change with three open source scanners, and sends anything bad straight back to the agent to fix.

We built the first working version in one session on 28 October 2026. This is how the build went, including the things that broke.

## The idea in one picture

`[img/gif/agent-loop.gif]`

We asked Claude Code for one small feature in a test shop app: "Add a findUserByEmail(email) function to src/users.js." Claude Code wrote a safe version. The file already had three old problems in it: SQL built from a template string, `innerHTML` set from a variable, and an `eval()`.

When Claude Code finished its turn, Fivebar's Stop hook scanned the two files it touched and sent this back:

```
fivebar · security check · round 1 of 3
3 problems in the files you changed. Fix each one, then finish your turn and Fivebar re-checks.
1. HIGH eval() runs any string as code
   where: src/users.js:16 (CWE-95)
   ...
```

Claude Code fixed all three in the same session. Fivebar re-checked, closed the three findings and marked the loop as passed. We ran the same request three times. Every run took one round and between 40 and 52 seconds from prompt to pass. The project score went from 28 to 51.

## What's inside

- **Opengrep 1.33.0** (LGPL) runs 12 rules we wrote for JavaScript, TypeScript and Python.
- **Gitleaks 8.30.1** (MIT) looks for secrets in files and in the commits you push.
- **OSV-Scanner 2.7.0** (Apache 2.0) checks lockfiles against the OSV advisory database.

Fivebar downloads each scanner from its GitHub release and checks it against a pinned SHA-256 before it ever runs. Results from the three tools get merged, so one problem found by two tools shows up once with both badges.

Everything else is plain Node: an Electron app, a local API on 127.0.0.1 with a random token, SQLite through sql.js so there's nothing native to compile, and an MCP server so the agent can ask for findings itself. AI work goes through the `claude` command you already have. There's no API key and no Fivebar server.

## Setting up

`[img/gif/setup-wizard.gif]`

Setup is six short steps, one job per screen. You pick your coding agents (Claude Code, Codex, Antigravity, or all three). Fivebar checks your PC for git, Claude Code and Tailscale, installs the scanners, and scans your first project. On the test shop that first scan found 10 problems in 2.6 seconds: two leaked keys, three code issues and five advisories for lodash 4.17.20.

Nothing in your project changes until you press Connect. The Connect screen shows every line Fivebar will write, file by file, before it writes it.

`[img/connect-01-plan.png]`

## The push guard

The git pre-push hook scans the files and commits in a push. On the test shop, with the Stripe and GitHub test keys still in `src/config.js`, the push stopped in 2.7 seconds:

```
✕ HIGH     Stripe key in code       src/config.js:2
✕ HIGH     GitHub token in code     src/config.js:3
fivebar ▸ push blocked. 4 findings at critical or high.
```

Early on, a secret slipped through. We committed a key, deleted it in the next commit, and pushed both. The files looked clean, so the push went through. The fix: Gitleaks now scans the commit range being pushed too, so a secret anywhere in the push history blocks it.

## The review gate

`[img/gate-03-result.png]`

The gate scores the latest change from 1 to 5 on security, correctness, readability, tests and maintainability. All five have to be 5. An AI reviewer gives the scores, run through `claude -p` with read-only tools. The scanners and your tests set hard limits it can't score above. A failing test caps correctness at 2. An open high finding caps security at 2.

On the shop the gate stayed shut at 0 of 5. The reviewer caught something we'd missed: Claude Code had swapped `eval` for `JSON.parse`, so any caller still passing code like `run("1+1")` now gets an error.

## What broke while we built it

Testing on a real setup turned up six problems. We fixed each one before taking these screenshots.

1. **OSV-Scanner found nothing.** The test project sat inside a folder that another repo's `.gitignore` ignores, and OSV-Scanner obeys outer `.gitignore` files. Fivebar now checks for that case and passes `--no-ignore` only then.
2. **The agent loop never ran on our PC.** The hook was connected and worked when run by hand, but Claude Code never called it. Our own Claude Code settings had `"disableAllHooks": true`. Fivebar now reads your Claude Code settings and warns you on the Connect screen when hooks are off.
3. **A message claimed `--no-verify` pushes get logged.** They don't. `--no-verify` skips the hook, so Fivebar never sees the push. We changed the wording.
4. **The review gate said "5 findings in this change"** when the change touched one file. The five were lodash advisories, which do count, because the change ships with them. The label now says "5 open (5 in dependencies)".
5. **The logo vanished on the dark setup screen.** The small shield used a fixed dark colour. It now follows the text colour.
6. **Ten fake secrets in a real project.** On LedgerQuarry, one of our own builds, Gitleaks spent 45 seconds reading a Python virtualenv and Rust build output, and flagged 10 "API keys" inside numpy tests and compiled files. Neither folder gets pushed, because .gitignore lists both. Fivebar now skips every folder git ignores. The same scan takes 2.9 seconds and the 10 false alarms are gone.

## What's next

Guards that stop risky commands inside the agent, a nightly scan, a phone app over your own Tailscale network, and direct connectors for Codex and Antigravity. Fivebar will be open source, and we want contributors. The repo goes public when the first release is ready.
