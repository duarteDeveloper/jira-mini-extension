export interface JiraUser {
  displayName?: string;
  emailAddress?: string;
  accountId?: string;
}

export interface JiraStatus {
  name: string;
  statusCategory?: {
    key: string;
    name: string;
  };
}

export interface JiraIssueType {
  name: string;
  subtask?: boolean;
}

export interface JiraProject {
  key: string;
  name: string;
}

export interface JiraPriority {
  name: string;
}

export interface JiraSubtask {
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
  };
}

export interface JiraIssueFields {
  summary: string;
  status: JiraStatus;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  issuetype?: JiraIssueType;
  project?: JiraProject;
  priority?: JiraPriority;
  labels?: string[];
  parent?: { key: string; fields?: { summary?: string } };
  description?: AdfNode | null;
  subtasks?: JiraSubtask[];
  created?: string;
  updated?: string;
  resolution?: { name: string } | null;
  components?: { name: string }[];
  fixVersions?: { name: string }[];
  /* story points — Jira Cloud standard custom field */
  customfield_10016?: number | null;
  /* fallback for story points in some Jira configs */
  story_points?: number | null;
}

export interface JiraIssue {
  key: string;
  fields: JiraIssueFields;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  maxResults: number;
}

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
}

export interface SddTask {
  id: string;
  summary: string;
  source: 'subtask' | 'taskItem' | 'heuristic';
  done: boolean;
}

export interface CacheEntry<T> {
  ts: number;
  data: T;
}

export interface JiraMiniConfig {
  baseUrl: string;
  defaultJql: string;
  maxResults: number;
  useEnhancedSearch: boolean;
  sddFolder: string;
  cacheTtlSeconds: number;
  authMode: JiraAuthMode;
  oauthClientId: string;
  oauthScopes: string;
  oauthAudience: string;
  sddProvider: SddProviderMode;
  sddNeverOverwrite: boolean;
}

export type JiraAuthMode = 'basic' | 'oauth';
export type SddProviderMode = 'auto' | 'spec-kit' | 'agent-os' | 'generic';

export interface JiraAuth {
  mode: JiraAuthMode;
  email?: string;
  token?: string;
  accessToken?: string;
  cloudId?: string;
  siteUrl?: string;
}

export interface JiraOAuthResourcesItem {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  avatarUrl?: string;
}

export interface JiraOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface JiraBoard {
  id: number;
  name: string;
  type?: string;
}

export interface JiraBoardsResponse {
  values: JiraBoard[];
}

export interface JiraSprint {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed' | string;
  goal?: string;
}

export interface JiraSprintsResponse {
  values: JiraSprint[];
}

export interface JiraEpic {
  id: number;
  key?: string;
  name: string;
  summary?: string;
  done?: boolean;
}

export interface JiraEpicsResponse {
  values: JiraEpic[];
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { id: string; name: string };
}

export interface JiraTransitionsResponse {
  transitions: JiraTransition[];
}

export interface WorkspaceSelections {
  selectedBoardId?: number;
  selectedBoardName?: string;
  selectedSprintId?: number;
}

export interface SddPathContext {
  issueKey: string;
  issueSlug: string;
  timestamp: string;
}

export interface SddOutputFile {
  relativePath: string;
  content: string;
}

export interface SddProviderOutput {
  spec: SddOutputFile;
  plan: SddOutputFile;
  extras: SddOutputFile[];
}

export interface SddProvider {
  readonly id: Exclude<SddProviderMode, 'auto'>;
  readonly label: string;
  detect(workspaceRoot: string): Promise<boolean>;
  buildOutput(
    workspaceRoot: string,
    issue: JiraIssue,
    tasks: SddTask[],
    baseBrowseUrl: string,
  ): SddProviderOutput;
  buildPlanPrompt(issueKey: string, specContent: string, planContent: string, baseBrowseUrl: string): string;
}
