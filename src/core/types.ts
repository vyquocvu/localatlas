export type Project = {
  id: string;
  key: string;
  name: string;
  sourcePath: string;
  managedPath: string;
  createdAt: string;
};

export type DocMeta = {
  path: string;
  etag: string;
  content: string;
  frontmatter: Record<string, unknown>;
  docId: string | null;
  parseWarning?: string;
};

export type ParsedDocument = {
  frontmatter: Record<string, unknown>;
  keyOrder: string[];
  body: string;
  hasFrontmatter: boolean;
  malformedFrontmatter: boolean;
  lineEnding?: string;
  parseWarning?: string;
};

export type ProjectEvent = {
  seq: number;
  type: 'doc_changed' | 'reindexed';
  projectId: string;
  path?: string;
  etag?: string;
};

export type DocSearchFilter = {
  type?: string;
  status?: string;
  priority?: string;
  milestone?: string;
  epic?: string;
  allProjects?: boolean;
};

export type DocSearchResult = {
  projectId: string;
  projectKey: string;
  projectName: string;
  path: string;
  docId: string | null;
  title: string;
  type: string | null;
  status: string | null;
  snippet: string;
  etag: string;
};

export type BacklinkEntry = {
  sourcePath: string;
  sourceId: string | null;
  sourceTitle: string;
  snippet: string;
};

export type FileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileTreeNode[];
};

export type BackupManifest = {
  version: 1;
  createdAt: string;
  files: Record<string, string>;
};

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type EpicStatus = 'todo' | 'in_progress' | 'done' | 'cancelled';
export type MilestoneStatus = 'open' | 'completed';

export const VALID_TASK_STATUSES = new Set<TaskStatus>(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
export const VALID_TASK_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high', 'critical']);
export const VALID_EPIC_STATUSES = new Set<EpicStatus>(['todo', 'in_progress', 'done', 'cancelled']);
export const VALID_MILESTONE_STATUSES = new Set<MilestoneStatus>(['open', 'completed']);

export type ChecklistCounts = {
  total: number;
  checked: number;
};

export type TaskRecord = {
  id: string;
  type: 'task';
  path: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  epic: string | null;
  milestone: string | null;
  etag: string;
  checklist: ChecklistCounts;
};

export type EpicRecord = {
  id: string;
  type: 'epic';
  path: string;
  title: string;
  status: EpicStatus;
  milestone: string | null;
  etag: string;
};

export type MilestoneRecord = {
  id: string;
  type: 'milestone';
  path: string;
  title: string;
  status: MilestoneStatus;
  targetDate: string | null;
  etag: string;
};

export type RollupCounts = {
  total: number;
  todo: number;
  inProgress: number;
  blocked: number;
  done: number;
  cancelled: number;
  completionRatio: number;
};

export type BrokenReference = {
  taskId: string | null;
  path: string;
  title: string;
  missingEpic?: string;
  missingMilestone?: string;
};

export type EpicRollup = {
  id: string;
  title: string;
  status: EpicStatus;
  milestone: string | null;
  counts: RollupCounts;
};

export type MilestoneRollup = {
  id: string;
  title: string;
  status: MilestoneStatus;
  targetDate: string | null;
  counts: RollupCounts;
};

export type ProjectRollup = {
  milestones: MilestoneRollup[];
  epics: EpicRollup[];
  brokenReferences: BrokenReference[];
};

export type GitCommitInfo = {
  sha: string;
  subject: string;
  author: string;
  timestamp: string;
};

export type GitState = {
  branch: string;
  head: GitCommitInfo | null;
  dirtyCount: number;
  recentCommits: GitCommitInfo[];
};

export type ProjectStatus = Project & {
  git: GitState | null;
};

export type AgentContextJson = {
  project: {
    id: string;
    key: string;
    name: string;
    sourcePath: string;
  };
  git: GitState | null;
  rollup: {
    milestones: Array<{ id: string; title: string; status: string; completionRatio: number; total: number; done: number }>;
    epics: Array<{ id: string; title: string; status: string; completionRatio: number; total: number; done: number }>;
  };
  tasks: {
    inProgress: Array<{ id: string; title: string; priority: string; epic: string | null; milestone: string | null }>;
    blocked: Array<{ id: string; title: string; priority: string; epic: string | null; milestone: string | null }>;
    todo: Array<{ id: string; title: string; priority: string; epic: string | null; milestone: string | null }>;
    doneCount: number;
    cancelledCount: number;
  };
  docs: Array<{ path: string; title: string; docId: string | null }>;
};

export interface PickDirectoryResult {
  supported: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

export interface DirectoryListing {
  current: string;
  parent: string | null;
  directories: Array<{ name: string; path: string }>;
  homedir: string;
  error?: string;
}
