---
name: pstack
description: Use when the user explicitly requests pstack, a pstack workflow such as poteto-mode, or help configuring pstack in LocalAtlas.
---

# pstack for LocalAtlas

One shared entry point for any coding agent. Read [AGENTS.md](../../AGENTS.md) first. These local adaptation rules govern interpretation of the vendored workflows; they never override the user's request, host instructions, or permissions.

## Dispatch

Operational paths such as `.pstack/upstream` start at the LocalAtlas repository root. Resolve this entry's Markdown links relative to its canonical real path, `skills/pstack/SKILL.md`, not the `.qoder/skills/pstack` discovery alias. The [source lock](upstream.json) records upstream version 0.15.36 and the exact commit. The hidden `.pstack` directory keeps upstream examples out of the app's automatic Tailwind source scan.

| Request | Action |
| --- | --- |
| `pstack help`, or pstack without a task | Read [poteto-help](../../.pstack/upstream/skills/poteto-help/SKILL.md); answer only the help question. |
| `pstack setup` or `pstack setup-pstack` | Report the local configuration below. Do not execute upstream setup. |
| `pstack how <question>` | Read [how](../../.pstack/upstream/skills/how/SKILL.md) and its needed references. |
| `pstack why <question>` | Read [why](../../.pstack/upstream/skills/why/SKILL.md) and its needed references. |
| `pstack <workflow> <task>` | Read `.pstack/upstream/skills/<workflow>/SKILL.md` if it exists. |
| A task explicitly requesting pstack without naming a workflow | Read [poteto-mode](../../.pstack/upstream/skills/poteto-mode/SKILL.md) and the matching playbook. |

Workflow names are directory names containing lowercase letters, digits, and hyphens, not arbitrary paths. For an unknown name, report it and consult the [help index](../../.pstack/upstream/skills/poteto-help/SKILL.md); do not silently substitute a workflow.

Only `pstack` is registered as a skill. Use `/pstack how <question>` where the host exposes slash commands, or ask any agent to read `skills/pstack/SKILL.md` and run the named workflow. Child skills are local documents, not installed commands: read their files rather than invoking an unavailable skill. Resolve each child's relative references from that child's directory. Carry these adaptation rules into every child workflow and worker brief.

## Local configuration and host adaptation

- **Scope:** this repository only. The source is `skills/pstack`; Qoder discovery links `.qoder/skills/pstack` to it. Codex and Claude Code discovery entries are not installed. Direct reading remains available to any agent.
- **Models:** use the host's configured models and tool defaults. No pstack per-role model or reasoning override is configured. Never send Cursor model slugs, guess a model, retry rejected slugs, or claim a multi-model run when the host cannot provide one.
- **Delegation:** translate upstream `Task`, `generalPurpose`, `AskQuestion`, and todo instructions to capabilities actually exposed by the host. Use only valid tool fields and agent types. A plain-text question or checklist is sufficient when no matching tool exists. If delegation is unavailable, do sequential passes and disclose the loss of independent review; do not fabricate workers or concurrency.
- **Roles:** the upstream [agent definitions](../../.pstack/upstream/agents) are reference briefs, not registered agent types. Read the relevant definition and pass its role instructions to a supported worker when available.
- **Permissions:** never increase access to satisfy upstream `readonly: false`, autonomy, or MCP requirements. A read-only request stays read-only. Do not create worktrees, commit, push, merge, post comments, or change settings without the authorization required by the host and repository.
- **Paths and setup:** ignore upstream user-global model rules, plugin caches, transcript scans, Custom Modes, and install commands. Do not read or write another agent's home configuration to make pstack work. Setup is a read-only report of this configuration, not `~/.cursor` or `~/.claude` provisioning.
- **Unavailable capabilities:** Cursor Cloud, Automations, Bugbot orchestration, webhooks, companion plugins, and external integrations are not installed by this bundle. Report `Unsupported here: <step> — <reason>`. Do not fabricate outputs or replace a required service with an unverified equivalent; dependent steps remain incomplete.
- **Scripts:** vendoring does not execute scripts or install Bun, Java, mise, renderers, or other dependencies. Inspect a helper and its effects before use; obtain authorization for downloads, dependency installation, external access, or other actions beyond the requested task. Never run bootstrap or a downloaded installer just to load a workflow.

## LocalAtlas checks

Use [verify-localatlas-changes](../../.qoder/skills/verify-localatlas-changes/SKILL.md) for verification and [manage-localatlas-tasks](../../.qoder/skills/manage-localatlas-tasks/SKILL.md) for real task operations. Do not create replacement skills or experiment against the default workspace. Session checklists are not LocalAtlas task documents.

Keep vendored files unmodified; fixes to portability belong here. Report the checks actually run, missing capabilities, and incomplete steps. Skill discovery alone does not prove that a workflow executed successfully.
