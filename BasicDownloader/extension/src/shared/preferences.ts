export interface ManagerPreferences {
  autoTitle: boolean;
  defaultFilename: string;
  autoProbe: boolean;
  batchProbe: boolean;
  downloadAfterProbe: boolean;
  filenameTemplate: string;
  groupCandidates: boolean;
  viewMode: "popup" | "sidepanel";
  notifyOnComplete: boolean;
  jobsCollapsed: boolean;
}
export const PREFERENCES_KEY = "managerPreferences";
export const DEFAULT_PREFERENCES: ManagerPreferences = {
  autoTitle: true, defaultFilename: "download", autoProbe: false, batchProbe: false, downloadAfterProbe: false, filenameTemplate: "{title}", groupCandidates: true,
  viewMode: "popup", notifyOnComplete: false, jobsCollapsed: false,
};
export function normalizePreferences(value: unknown): ManagerPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of ["autoTitle", "autoProbe", "batchProbe", "downloadAfterProbe", "groupCandidates", "notifyOnComplete", "jobsCollapsed"] as const) {
    if (typeof input[key] === "boolean") result[key] = input[key];
  }
  if (input.viewMode === "popup" || input.viewMode === "sidepanel") result.viewMode = input.viewMode;
  if (typeof input.defaultFilename === "string") {
    const name = input.defaultFilename.trim().replace(/[. ]+$/g, "");
    if (name && name.length <= 120 && !/[<>:"/\\|?*\x00-\x1f]/.test(name)
        && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) result.defaultFilename = name;
  }
  if (typeof input.filenameTemplate === "string" && input.filenameTemplate.trim()
      && input.filenameTemplate.length <= 120 && !/[<>:"/\\|?*\x00-\x1f]/.test(input.filenameTemplate)
      && !/\{(?!title\}|quality\}|date\})[^}]*\}/.test(input.filenameTemplate)) {
    result.filenameTemplate = input.filenameTemplate.trim();
  }
  return result;
}
