const STORAGE_KEY = "architecture-workspace.projects.v1";

export type RecentArchitectureProject = {
  threadId: string;
  localTitle?: string;
  requirement?: string;
  currentRevision?: number;
  lastOpenedAt: string;
  lastCompletedAt?: string;
  unavailable?: boolean;
};

export function listRecentProjects(): RecentArchitectureProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function saveRecentProject(project: RecentArchitectureProject): void {
  const projects = listRecentProjects().filter(
    (item) => item.threadId !== project.threadId,
  );
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([project, ...projects].slice(0, 20)),
  );
}

export function getRecentProject(
  threadId: string,
): RecentArchitectureProject | undefined {
  return listRecentProjects().find((item) => item.threadId === threadId);
}

export function removeRecentProject(threadId: string): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      listRecentProjects().filter((item) => item.threadId !== threadId),
    ),
  );
}

export function createThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `architecture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
