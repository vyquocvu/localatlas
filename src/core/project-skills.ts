import { cp, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSymlinkChain, home } from './paths.js';

// Project-neutral pstack entry point copied into each imported project's LocalAtlas
// workspace. Distinct from the LocalAtlas development adapter in the repository root:
// it carries no repo-specific references and adds the imported-source read-only rule.
export const PSTACK_ADAPTER_SKILL_MD = `---
name: pstack
description: Use when the user explicitly requests pstack, a pstack workflow such as poteto-mode, or help configuring pstack in this project.
---

# pstack for this LocalAtlas project

One shared entry point for any coding agent (Qoder, Codex, Claude Code). These local rules govern how the vendored pstack workflows are interpreted here; they never override the user's request, host instructions, or permissions.

## Dispatch

This skill lives in the project's LocalAtlas workspace. Resolve its Markdown links from this file's canonical real path (.pstack/skill/SKILL.md), not from a .qoder, .agents, or .claude discovery alias. The upstream bundle is at ../upstream/ (.pstack/upstream/); its plugin.json records the pinned version.

| Request | Action |
| --- | --- |
| "pstack help", or pstack without a task | Read [poteto-help](../upstream/skills/poteto-help/SKILL.md); answer only the help question. |
| "pstack setup" | Report this configuration. Do not execute upstream setup. |
| "pstack how <question>" | Read [how](../upstream/skills/how/SKILL.md) and its needed references. |
| "pstack why <question>" | Read [why](../upstream/skills/why/SKILL.md) and its needed references. |
| "pstack <workflow> <task>" | Read ../upstream/skills/<workflow>/SKILL.md if it exists. |
| A task requesting pstack without naming a workflow | Read [poteto-mode](../upstream/skills/poteto-mode/SKILL.md) and the matching playbook. |

Workflow names are directory names (lowercase letters, digits, hyphens), not arbitrary paths. For an unknown name, report it and consult the help index; do not silently substitute a workflow. Only pstack is registered as a skill; child workflows are local documents, so read their files rather than invoking an unavailable skill, and resolve each child's references from its own directory. Carry these rules into every child workflow and worker brief.

## Host adaptation and limits

- Models: use the host's configured models and tool defaults. No per-role model or reasoning override. Never send Cursor model slugs, guess a model, or claim a multi-model run the host cannot provide.
- Delegation: translate upstream Task, generalPurpose, AskQuestion, and todo steps to capabilities the host actually exposes, using only valid tool fields and agent types. If delegation is unavailable, do sequential passes and disclose the loss of independent review; never fabricate workers.
- Roles: the upstream [agent definitions](../upstream/agents) are reference briefs, not registered agent types.
- Permissions: never increase access to satisfy upstream readonly:false, autonomy, or MCP requirements. A read-only request stays read-only. Do not create worktrees, commit, push, merge, post comments, or change settings without the authorization the host and user require.
- Unavailable features: Cursor Cloud, Automations, Bugbot, webhooks, companion plugins, and external integrations are not installed. Report "Unsupported here: <step> - <reason>"; do not fabricate outputs or substitute unverified services.
- Scripts: the bundle's scripts are not run on install and their dependencies (Bun, Java, mise, renderers) are not provisioned. Inspect a helper and its effects, and get authorization before downloads, installs, or external access. Never run bootstrap just to load a workflow.
- Setup: ignore upstream user-global model rules, plugin caches, transcript scans, Custom Modes, and install commands; do not read or write another agent's home configuration. "setup" is a read-only report of this configuration.

## LocalAtlas project rules

- The imported source repository is read-only context. Never create, modify, or delete files in it, and never run Git mutations there, as a side effect of pstack work. Make source changes only where the user explicitly asks.
- Use the LocalAtlas CLI for Atlas tasks and documents (localatlas task ..., localatlas read/write ..., --project <ID>, ETags on writes). Never handwrite Atlas task Markdown. Session checklists or todos are not Atlas task documents.
- Keep pstack outputs (notes, plans) inside this LocalAtlas workspace, not the source repository.

Report the checks actually run, missing capabilities, and incomplete steps. Skill discovery alone does not prove a workflow ran successfully.
`;

const DISCOVERY_DIRS = ['.qoder', '.agents', '.claude'] as const;
const SKILL_LINK_TARGET = join('..', '..', '.pstack', 'skill');

// MVP resolves the bundle from the LocalAtlas checkout (or an explicit override). Shipping
// pstack inside the packaged desktop/npm artifact is a separate release gate; when the bundle
// is absent, linking is skipped so import still succeeds.
export function resolvePstackBundleDir(): string | null {
  const override = process.env.LOCALATLAS_PSTACK_BUNDLE;
  if (override && override.trim()) return override;
  return fileURLToPath(new URL('../../.pstack/upstream', import.meta.url));
}

async function ensureDiscoveryLinks(managedPath: string): Promise<void> {
  for (const base of DISCOVERY_DIRS) {
    const skillsDir = join(managedPath, base, 'skills');
    await mkdir(skillsDir, { recursive: true, mode: 0o700 });
    const link = join(skillsDir, 'pstack');
    try {
      const existing = await lstat(link);
      if (existing.isSymbolicLink()) {
        if ((await readlink(link)) === SKILL_LINK_TARGET) continue;
        await rm(link, { force: true });
      } else {
        continue; // a real entry the user placed here; never clobber it
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await symlink(SKILL_LINK_TARGET, link, 'dir');
  }
}

export async function ensureProjectPstack(project: { managedPath: string }): Promise<void> {
  const bundleDir = resolvePstackBundleDir();
  if (!bundleDir) return;

  let version: string;
  try {
    const manifest = JSON.parse(await readFile(join(bundleDir, 'plugin.json'), 'utf8')) as { version?: unknown };
    if (typeof manifest.version !== 'string' || !manifest.version) return;
    version = manifest.version;
  } catch {
    return; // no bundle available (e.g. packaged app before the resource is shipped)
  }

  const target = join(project.managedPath, '.pstack');
  const marker = join(target, 'version.json');
  try {
    const current = JSON.parse(await readFile(marker, 'utf8')) as { version?: string };
    if (current.version === version) {
      await ensureDiscoveryLinks(project.managedPath);
      return;
    }
  } catch { /* first run or stale marker: (re)copy below */ }

  await assertNoSymlinkChain(home(), project.managedPath);
  await mkdir(target, { recursive: true, mode: 0o700 });
  await rm(join(target, 'upstream'), { recursive: true, force: true });
  await cp(bundleDir, join(target, 'upstream'), { recursive: true, force: true, errorOnExist: false });
  await mkdir(join(target, 'skill'), { recursive: true, mode: 0o700 });
  await writeFile(join(target, 'skill', 'SKILL.md'), PSTACK_ADAPTER_SKILL_MD, { encoding: 'utf8', mode: 0o600 });
  await writeFile(marker, JSON.stringify({ version }) + '\n', { encoding: 'utf8', mode: 0o600 });
  await ensureDiscoveryLinks(project.managedPath);
}
