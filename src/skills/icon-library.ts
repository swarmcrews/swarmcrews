import type { SwarmcrewsIconName } from "../components/SwarmcrewsIcon.tsx";

export const SKILL_ICON_PREFIX = "swarmcrews:";
export const LEGACY_SKILL_ICON_PREFIX = "minions:";
export function normalizeSkillIcon(value: string): string {
  return value.startsWith(LEGACY_SKILL_ICON_PREFIX)
    ? SKILL_ICON_PREFIX + value.slice(LEGACY_SKILL_ICON_PREFIX.length) : value;
}

export interface SkillIconEntry {
  name: SwarmcrewsIconName;
  label: string;
  group: string;
  keywords: string;
}

// Stable IDs travel in the existing icon string through save, import and export.
// Keep the catalog explicit: no remote assets or dynamically imported icon packs.
const groups: { group: string; keywords: string; names: SwarmcrewsIconName[] }[] = [
  { group: "Code", keywords: "development programming software engineering", names: [
    "code", "terminal", "brackets", "variables", "branch", "merge", "commit", "worktree", "database", "api", "package", "puzzle", "cpu", "regex",
  ] },
  { group: "Quality & security", keywords: "testing review audit safety validation", names: [
    "testing", "bug", "shield", "lock", "key", "scan", "fingerprint", "eye", "target", "gauge", "checklist", "microscope", "check", "warning",
  ] },
  { group: "Infrastructure", keywords: "devops deploy server cloud automation hosting", names: [
    "devops", "cloud", "rocket", "globe", "network", "container", "workflow", "satellite", "plug", "layers", "settings", "retry",
  ] },
  { group: "Writing", keywords: "docs documentation content text editing knowledge", names: [
    "file", "pen", "book", "notebook", "heading", "quote", "list", "bookmark", "archive", "translate", "link", "folder", "folder-open", "attachment",
  ] },
  { group: "Design & media", keywords: "creative visual ui ux art video audio", names: [
    "appearance", "brush", "layout", "grid", "vector", "image", "camera", "film", "music", "headphones", "phone", "monitor", "ruler",
  ] },
  { group: "Research", keywords: "analysis data science discovery investigation", names: [
    "analysis", "chart", "trend", "pie", "table", "filter", "compass", "map", "flask", "atom", "brain", "lightbulb",
  ] },
  { group: "Planning & people", keywords: "general team collaboration task time schedule", names: [
    "message", "people", "flag", "calendar", "clock", "wait", "play", "pause", "planned", "active", "subskills", "compaction", "waived",
  ] },
  { group: "Essentials", keywords: "general assistant agent favorite inspiration", names: [
    "skill", "bot", "sparkles", "wand", "live", "heart", "leaf", "diamond", "trophy", "cube", "orbit", "close", "minus",
  ] },
];

const labels: Partial<Record<SwarmcrewsIconName, string>> = {
  appearance: "Palette", api: "API", cpu: "Processor", regex: "Regular expression",
  devops: "Servers", analysis: "Research", testing: "Test tube", live: "Lightning",
  subskills: "Sub-skills", compaction: "Focus", waived: "Cycle", planned: "Circle",
  active: "Activity", retry: "History", pie: "Pie chart", chart: "Bar chart",
  trend: "Trending up", "folder-open": "Open folder", skill: "Skill hexagon",
};

export const SKILL_ICON_LIBRARY: SkillIconEntry[] = groups.flatMap(({ group, keywords, names }) =>
  names.map((name) => ({
    name,
    label: labels[name] ?? name.charAt(0).toUpperCase() + name.slice(1),
    group,
    keywords,
  })),
);
export const SKILL_ICON_GROUPS = groups.map(({ group }) => group);
