# Agent Rules

These rules are mandatory for any automated or human-assisted commit in this repository.

## Context Router Contract (Bidirectional)

All agents should follow standard core command behavior.

## Skill Location Contract

Invokable core skills are sourced from:
- `C:\Users\Jared Mahotiere\.codex\skills`

## Commit Cleanliness Contract

- Use conventional commits for the subject line.
- Keep one logical change per commit.
- `Co-authored-by` trailers are forbidden.
- AI trace text is forbidden in commit messages (for example: `ChatGPT`, `Claude`, `OpenAI`, `Anthropic`, `Copilot`, `AI-generated`).

## Required Setup

Run this once per clone:

```powershell
npm run setup:hooks
```

This enables:
- `.githooks/commit-msg`: blocks non-compliant commit messages.
- `.githooks/pre-push`: blocks pushes with non-compliant commit metadata/history.

