// ─── Agent NounIRL — Autonomous Deployer ────────────────────────────────────
//
// Uses Claude API to generate code patches, pushes to GitHub, and triggers
// Netlify deploys. Rate-limited and scoped to frontend files only.

import { hubGenerate } from './hubClient.js';
import { MAX_DEPLOYS_PER_HOUR, DEPLOY_ALLOWED_PATHS } from './constants.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface FilePatch {
  path: string;       // relative to repo root, e.g. "packages/nouns-webapp/src/components/Foo.tsx"
  action: 'create' | 'modify' | 'delete';
  content?: string;   // full file content for create/modify
}

export interface DeployResult {
  success: boolean;
  error?: string;
  branch?: string;
  commitSha?: string;
  deployUrl?: string;
  patches: FilePatch[];
  timestamp: number;
  reason: string;
}

interface DeployRecord {
  id: string;
  result: DeployResult;
  triggeredBy: string; // 'settlement' | 'terminal' | 'scheduled'
}

// ─── State ─────────────────────────────────────────────────────────────────

const deployHistory: DeployRecord[] = [];
let lastDeployTime = 0;

// ─── Path Validation ───────────────────────────────────────────────────────

function isAllowedPath(path: string): boolean {
  return DEPLOY_ALLOWED_PATHS.some(prefix => path.startsWith(prefix));
}

// ─── Generate Code Patch via Claude API ────────────────────────────────────

export async function generatePatch(
  description: string,
  context: Record<string, unknown> = {},
): Promise<FilePatch[]> {
  const systemPrompt = `You are Agent NounIRL's code generation module. You generate precise, minimal code patches for the noun.wtf frontend (a Vite + React + TypeScript webapp).

RULES:
- Only output JSON — an array of file patches
- Each patch: { "path": "packages/nouns-webapp/src/...", "action": "create"|"modify"|"delete", "content": "..." }
- Only modify files under packages/nouns-webapp/src/
- Keep changes minimal and focused
- Match existing code style (TypeScript, inline styles, React functional components)
- Never break the build — all TypeScript must compile

Output ONLY valid JSON array, no markdown fences, no explanation.`;

  const text = await hubGenerate({
    system: systemPrompt,
    user: `Generate a code patch for the following change:\n\n${description}\n\nContext: ${JSON.stringify(context, null, 2)}\n\nReturn a JSON array of FilePatch objects.`,
    task: 'codeGen',
    maxTokens: 4096,
    temperature: 0.3,
  });

  // Parse JSON response
  const patches = JSON.parse(text) as FilePatch[];

  // Validate all paths
  for (const patch of patches) {
    if (!isAllowedPath(patch.path)) {
      throw new Error(`Patch path not allowed: ${patch.path}`);
    }
  }

  return patches;
}

// ─── GitHub API Operations ─────────────────────────────────────────────────

async function githubApi(
  endpoint: string,
  method: string = 'GET',
  body?: unknown,
): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');

  const repo = process.env.GITHUB_REPO || 'mshrmstudio/noun-wtf';
  const url = `https://api.github.com/repos/${repo}${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${errText}`);
  }

  return res.json();
}

/**
 * Create a branch, commit patches, push, and optionally trigger Netlify deploy.
 */
export async function applyAndDeploy(
  patches: FilePatch[],
  commitMessage: string,
  reason: string,
  triggeredBy: string = 'agent',
): Promise<DeployResult> {
  const now = Date.now();

  // Rate limit check
  if (now - lastDeployTime < (3600_000 / MAX_DEPLOYS_PER_HOUR)) {
    const result: DeployResult = {
      success: false,
      error: `Rate limited — max ${MAX_DEPLOYS_PER_HOUR} deploy(s) per hour`,
      patches,
      timestamp: now,
      reason,
    };
    recordDeploy(result, triggeredBy);
    return result;
  }

  try {
    // 1. Get the default branch's latest commit SHA
    const ref = await githubApi('/git/ref/heads/main') as { object: { sha: string } };
    const baseSha = ref.object.sha;

    // 2. Create a new branch
    const branchName = `nounirl/${Date.now()}-${reason.replace(/\s+/g, '-').slice(0, 30)}`;
    await githubApi('/git/refs', 'POST', {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // 3. Get the base tree
    const baseCommit = await githubApi(`/git/commits/${baseSha}`) as { tree: { sha: string } };
    const baseTreeSha = baseCommit.tree.sha;

    // 4. Create blobs for each file
    const treeItems: Array<{
      path: string;
      mode: string;
      type: string;
      sha?: string;
      content?: string;
    }> = [];

    for (const patch of patches) {
      if (patch.action === 'delete') {
        // GitHub Trees API: set sha to null to delete
        treeItems.push({
          path: patch.path,
          mode: '100644',
          type: 'blob',
          sha: undefined,
        });
      } else {
        // Create blob
        const blob = await githubApi('/git/blobs', 'POST', {
          content: patch.content,
          encoding: 'utf-8',
        }) as { sha: string };

        treeItems.push({
          path: patch.path,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        });
      }
    }

    // 5. Create tree
    const tree = await githubApi('/git/trees', 'POST', {
      base_tree: baseTreeSha,
      tree: treeItems,
    }) as { sha: string };

    // 6. Create commit
    const commit = await githubApi('/git/commits', 'POST', {
      message: `[NounIRL] ${commitMessage}\n\nAutonomous deploy by Agent NounIRL\nReason: ${reason}`,
      tree: tree.sha,
      parents: [baseSha],
    }) as { sha: string };

    // 7. Update branch ref
    await githubApi(`/git/refs/heads/${branchName}`, 'PATCH', {
      sha: commit.sha,
    });

    // 8. Trigger Netlify deploy (if configured)
    let deployUrl: string | undefined;
    const netlifyHook = process.env.NETLIFY_BUILD_HOOK;
    if (netlifyHook) {
      try {
        await fetch(netlifyHook, { method: 'POST' });
        deployUrl = 'https://noun.wtf';
      } catch (err) {
        console.error('[NounIRL] Netlify deploy hook failed:', err);
      }
    }

    lastDeployTime = now;

    const result: DeployResult = {
      success: true,
      branch: branchName,
      commitSha: commit.sha,
      deployUrl,
      patches,
      timestamp: now,
      reason,
    };

    recordDeploy(result, triggeredBy);
    console.log(`[NounIRL] ✅ Deploy successful — branch: ${branchName}, commit: ${commit.sha}`);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[NounIRL] Deploy failed:', msg);

    const result: DeployResult = {
      success: false,
      error: msg,
      patches,
      timestamp: now,
      reason,
    };

    recordDeploy(result, triggeredBy);
    return result;
  }
}

// ─── Deploy History ────────────────────────────────────────────────────────

function recordDeploy(result: DeployResult, triggeredBy: string): void {
  deployHistory.push({
    id: crypto.randomUUID(),
    result,
    triggeredBy,
  });

  // Keep last 100 deploys
  if (deployHistory.length > 100) {
    deployHistory.splice(0, deployHistory.length - 100);
  }
}

export function getDeployHistory(limit = 20): DeployRecord[] {
  return deployHistory.slice(-limit).reverse();
}

export function canDeploy(): boolean {
  return Date.now() - lastDeployTime >= (3600_000 / MAX_DEPLOYS_PER_HOUR);
}
