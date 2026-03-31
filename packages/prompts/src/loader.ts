// QYRO Prompt Loader
// Loads versioned prompt packs from docs/PROMPTS/ at runtime.
// Parses YAML frontmatter + markdown body via gray-matter.
//
// Rules:
//   - Only approved prompts (status: "approved") may be loaded by agents
//   - Unresolved {{placeholders}} are left intact — QA agent will catch them
//   - PROMPTS_DIR env var overrides the default path (useful in tests)

import fs   from "fs";
import path from "path";
import matter from "gray-matter";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PromptFrontmatter = {
  id:               string;
  version:          number;
  product:          "lead" | "assist";
  niche:            string;
  channel:          "email" | "sms" | "voice";
  status:           "draft" | "approved" | "deprecated";
  approvedBy?:      string;
  bannedPhrases:    string[];
  approvedServices: string[];
  placeholders:     string[];
};

export type PromptPack = {
  meta:     PromptFrontmatter;
  body:     string;   // template text with {{placeholders}}
  filePath: string;
};

// ─── Prompts directory ─────────────────────────────────────────────────────────

function getPromptsDir(): string {
  return (
    process.env.PROMPTS_DIR ??
    path.resolve(__dirname, "../../../../docs/PROMPTS")
  );
}

// ─── Load a single prompt pack by ID ──────────────────────────────────────────

export function loadPromptPack(promptPackId: string): PromptPack {
  const dir      = getPromptsDir();
  const filePath = findPromptFile(dir, promptPackId);

  if (!filePath) {
    throw new Error(`Prompt pack not found: "${promptPackId}" (dir: ${dir})`);
  }

  const raw    = fs.readFileSync(filePath, "utf-8");
  const parsed = matter(raw);
  const meta   = parsed.data as PromptFrontmatter;

  if (!meta.id || !meta.channel || !meta.status) {
    throw new Error(`Prompt pack "${promptPackId}" is missing required frontmatter (id, channel, status)`);
  }

  if (meta.status !== "approved") {
    throw new Error(`Prompt pack "${promptPackId}" is not approved (status: ${meta.status})`);
  }

  return { meta, body: parsed.content.trim(), filePath };
}

// ─── Resolve {{placeholders}} in a template ────────────────────────────────────

export function resolvePlaceholders(
  template: string,
  vars:     Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return vars[key] ?? match;  // leave unresolved — QA will catch them
  });
}

// ─── List all prompt packs (optional product filter) ──────────────────────────

export function listPromptPacks(product?: "lead" | "assist"): PromptPack[] {
  const dir = getPromptsDir();
  if (!fs.existsSync(dir)) return [];

  const packs: PromptPack[] = [];

  for (const filePath of walkDir(dir).filter((f) => f.endsWith(".md"))) {
    try {
      const raw    = fs.readFileSync(filePath, "utf-8");
      const parsed = matter(raw);
      const meta   = parsed.data as PromptFrontmatter;

      if (!meta.id) continue;
      if (product && meta.product !== product) continue;

      packs.push({ meta, body: parsed.content.trim(), filePath });
    } catch {
      // skip malformed files silently
    }
  }

  return packs;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function findPromptFile(dir: string, promptPackId: string): string | null {
  for (const filePath of walkDir(dir)) {
    if (!filePath.endsWith(".md")) continue;

    // Match by filename stem first (faster)
    if (path.basename(filePath, ".md") === promptPackId) return filePath;

    // Fall back: check frontmatter id
    try {
      const parsed = matter(fs.readFileSync(filePath, "utf-8"));
      if ((parsed.data as PromptFrontmatter).id === promptPackId) return filePath;
    } catch {
      // skip
    }
  }
  return null;
}

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}
