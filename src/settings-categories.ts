import { Bot, LayoutGrid, MessageSquareText, Palette, Plus, ShieldCheck } from "lucide-react";

export type SettingsCategory =
  | "general"
  | "agents"
  | "workspace"
  | "connections"
  | "actions"
  | "governance";
export const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsCategory;
  label: string;
  description: string;
  icon: typeof Palette;
  section: "project" | "labs";
}> = [
  {
    id: "general",
    label: "General",
    description: "Look and feel",
    icon: Palette,
    section: "project",
  },
  {
    id: "agents",
    label: "Agent defaults",
    description: "Models and access",
    icon: Bot,
    section: "project",
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Canvas behavior",
    icon: LayoutGrid,
    section: "project",
  },
  { id: "connections", label: "Connections", description: "Apps and MCP tools", icon: Plus, section: "project" },
  {
    id: "actions",
    label: "Context actions",
    description: "Dashboard prompts",
    icon: MessageSquareText,
    section: "labs",
  },
  {
    id: "governance",
    label: "Governance",
    description: "System model",
    icon: ShieldCheck,
    section: "labs",
  },
];
