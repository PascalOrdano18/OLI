# Agent Orchestrator — Reference

Spawns and manages fleets of parallel AI coding agents, each in isolated git worktrees. Agents work autonomously on issues: create branches, write code, open PRs, respond to CI failures and review comments.

## Install

```bash
npm install -g @composio/ao
# or
npx @composio/ao start
```

**Prerequisites:** Node 20+, Git 2.25+, tmux, `gh` (authenticated with `repo` scope)

## Quick Start

```bash
ao start https://github.com/org/repo   # clone + configure + launch dashboard
ao start                                # auto-detect from cwd
ao start ~/existing-repo               # add local repo
```

Dashboard opens at http://localhost:3000

## Core Commands

```bash
ao status                       # text view of all sessions + branches + PRs
ao dashboard                    # open web dashboard
ao stop                         # stop everything

ao spawn 123                    # start agent on issue #123
ao spawn 123 --agent codex      # override agent
ao batch-spawn 101 102 103      # spawn multiple
ao send <session> "message"     # send instruction to running agent

ao session ls                   # list sessions
ao session kill <session>       # kill + cleanup
ao session restore <session>    # revive crashed agent

ao doctor                       # diagnose install issues
ao doctor --fix                 # apply safe fixes
```

## Configuration (`agent-orchestrator.yaml`)

```yaml
# Top-level (optional, all have defaults)
dataDir: ~/.agent-orchestrator
worktreeDir: ~/.worktrees
port: 3000

defaults:
  runtime: tmux                  # tmux | process | docker | ssh | e2b
  agent: claude-code             # claude-code | codex | aider | goose | opencode
  workspace: worktree            # worktree | clone

projects:
  my-app:
    repo: owner/repo             # required
    path: ~/my-app               # required
    defaultBranch: main          # required
    sessionPrefix: app           # optional

    agentConfig:
      model: claude-sonnet-4-5
      permissions: auto          # auto | manual

    agentRules: |
      Always run tests before pushing.
      Use conventional commits.

    # Workspace setup
    symlinks:
      - node_modules
    postCreate:
      - pnpm install

    # Issue tracker (default: github)
    tracker:
      plugin: linear
      teamId: "your-team-id"    # LINEAR_API_KEY env var required

    # Reactions
    reactions:
      ci-failed:
        auto: true               # send CI logs to agent automatically
        retries: 2
        escalateAfter: 2         # notify human after N failures
      changes-requested:
        auto: true               # forward review comments to agent
        escalateAfter: 30m
      approved-and-green:
        auto: false              # set true to enable auto-merge
      agent-stuck:
        threshold: 10m           # notify human after 10 min inactivity

# Notifications (optional)
notifiers:
  slack:
    plugin: slack
    webhook: ${SLACK_WEBHOOK_URL}
    channel: "#agent-updates"

notificationRouting:
  urgent: [desktop, slack]       # agent stuck, needs input, errored
  action: [desktop, slack]       # PR ready to merge
  info: [slack]
```

## Key Concepts

- **Session** — one agent on one issue. Named `{prefix}-{N}` (e.g. `app-1`).
- **Worktree** — agent workspace; shares `.git` with main repo (fast, default).
- **Reactions** — automated responses to CI failures, review comments, approvals. `auto: true` handles without human input.
- **Hash-based naming** — config path → SHA256 prefix prevents collisions when running multiple orchestrators.

## Typical Workflow

```bash
ao start                        # launch orchestrator + dashboard
ao spawn 123                    # agent creates branch, writes code, opens PR
# CI fails → agent auto-retries with logs
# Reviewer comments → agent responds automatically
# Approved + green → notification (or auto-merge if enabled)
ao status                       # monitor progress
ao send app-1 "also add tests"  # inject instructions mid-session
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ao doctor` | Always run this first |
| tmux not found | `brew install tmux` |
| gh auth failed | `gh auth login` (needs `repo` scope) |
| LINEAR_API_KEY missing | `export LINEAR_API_KEY="lin_api_..."` |
| Port in use | `ao start` auto-finds free port, or set `port:` in config |
| YAML parse error | Use 2-space indent, validate at yamllint.com |
