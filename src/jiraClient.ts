import * as vscode from 'vscode';
import {
  CacheEntry,
  JiraAuth,
  JiraBoard,
  JiraBoardsResponse,
  JiraEpic,
  JiraEpicsResponse,
  JiraIssue,
  JiraMiniConfig,
  JiraOAuthResourcesItem,
  JiraOAuthTokenResponse,
  JiraSearchResult,
  JiraSprint,
  JiraSprintsResponse,
  JiraTransition,
  JiraTransitionsResponse,
  JiraUser,
} from './types';

const CACHE_PREFIX = 'jiraMini.cache::';
const memoryCache = new Map<string, CacheEntry<unknown>>();
const CORE_REST_PREFIX = '/rest/api/3';
const AGILE_REST_PREFIX = '/rest/agile/1.0';

export function getConfig(): JiraMiniConfig {
  const cfg = vscode.workspace.getConfiguration('jiraMini');
  return {
    baseUrl: (cfg.get<string>('baseUrl') || '').replace(/\/+$/, ''),
    defaultJql: cfg.get<string>('defaultJql') || 'assignee = currentUser() ORDER BY updated DESC',
    maxResults: cfg.get<number>('maxResults') || 50,
    useEnhancedSearch: cfg.get<boolean>('useEnhancedSearch') ?? true,
    sddFolder: cfg.get<string>('sddFolder') || '.sdd',
    cacheTtlSeconds: cfg.get<number>('cacheTtlSeconds') || 60,
    authMode: cfg.get<'basic' | 'oauth'>('authMode') || 'basic',
    oauthClientId: cfg.get<string>('oauthClientId') || '',
    oauthScopes: cfg.get<string>('oauthScopes') || 'read:jira-work read:jira-user',
    oauthAudience: cfg.get<string>('oauthAudience') || 'api.atlassian.com',
    sddProvider: cfg.get<'auto' | 'spec-kit' | 'agent-os' | 'generic'>('sdd.provider') || 'auto',
    sddNeverOverwrite: cfg.get<boolean>('sdd.neverOverwrite') ?? true,
  };
}

export async function getAuth(secrets: vscode.SecretStorage): Promise<JiraAuth | undefined> {
  const config = getConfig();
  if (config.authMode === 'oauth') {
    const accessToken = await secrets.get('jiraMini.oauth.accessToken');
    const cloudId = await secrets.get('jiraMini.oauth.cloudId');
    const siteUrl = await secrets.get('jiraMini.oauth.siteUrl');
    if (!accessToken || !cloudId || !siteUrl) {
      vscode.window.showErrorMessage('Jira Mini: OAuth not configured. Run "Jira Mini: Connect..." first.');
      return undefined;
    }
    return { mode: 'oauth', accessToken, cloudId, siteUrl };
  }

  const email = await secrets.get('jiraMini.email');
  const token = await secrets.get('jiraMini.token');
  if (!email || !token) {
    vscode.window.showErrorMessage('Jira Mini: Auth not configured. Run "Jira Mini: Connect..." first.');
    return undefined;
  }
  return { mode: 'basic', email, token };
}

export async function testBasicConnection(baseUrl: string, email: string, token: string): Promise<void> {
  const auth: JiraAuth = { mode: 'basic', email, token };
  await jiraApiFetch(baseUrl, '/rest/api/3/myself', auth);
}

export async function oauthExchangeToken(params: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<JiraOAuthTokenResponse> {
  const res = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    }),
  });
  return readJsonOrThrow<JiraOAuthTokenResponse>(res, 'Atlassian OAuth');
}

export async function oauthRefreshToken(params: {
  clientId: string;
  refreshToken: string;
}): Promise<JiraOAuthTokenResponse> {
  const res = await fetch('https://auth.atlassian.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: params.clientId,
      refresh_token: params.refreshToken,
    }),
  });
  return readJsonOrThrow<JiraOAuthTokenResponse>(res, 'Atlassian OAuth');
}

export async function oauthAccessibleResources(accessToken: string): Promise<JiraOAuthResourcesItem[]> {
  const res = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${accessToken}` },
  });
  return readJsonOrThrow<JiraOAuthResourcesItem[]>(res, 'Atlassian OAuth');
}

function authHeader(auth: JiraAuth): string {
  if (auth.mode === 'oauth') {
    if (!auth.accessToken) {
      throw new Error('OAuth access token is missing.');
    }
    return `Bearer ${auth.accessToken}`;
  }
  if (!auth.email || !auth.token) {
    throw new Error('Basic auth credentials are missing.');
  }
  return 'Basic ' + Buffer.from(`${auth.email}:${auth.token}`).toString('base64');
}

function apiBaseUrl(config: JiraMiniConfig, auth: JiraAuth): string {
  if (auth.mode === 'oauth') {
    if (!auth.cloudId) {
      throw new Error('OAuth cloudId is missing.');
    }
    return `https://api.atlassian.com/ex/jira/${auth.cloudId}`;
  }
  if (!config.baseUrl) {
    throw new Error('Jira Mini: Set jiraMini.baseUrl in settings first.');
  }
  return config.baseUrl;
}

export function browseBaseUrl(config: JiraMiniConfig, auth: JiraAuth): string {
  if (auth.mode === 'oauth') {
    return (auth.siteUrl || '').replace(/\/+$/, '');
  }
  return config.baseUrl;
}

function cacheKey(instanceKey: string, jql: string, maxResults: number): string {
  return `${instanceKey}::${jql}::${maxResults}`;
}

function getCached<T>(key: string, ttl: number, workspaceState: vscode.Memento): T | undefined {
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (mem && (Date.now() - mem.ts) < ttl * 1000) {
    return mem.data;
  }

  const ws = workspaceState.get<CacheEntry<T>>(CACHE_PREFIX + key);
  if (ws && (Date.now() - ws.ts) < ttl * 1000) {
    memoryCache.set(key, ws);
    return ws.data;
  }
  return undefined;
}

function setCache<T>(key: string, data: T, workspaceState: vscode.Memento): void {
  const entry: CacheEntry<T> = { ts: Date.now(), data };
  memoryCache.set(key, entry);
  void workspaceState.update(CACHE_PREFIX + key, entry);
}

export function clearCache(workspaceState: vscode.Memento): void {
  memoryCache.clear();
  for (const key of workspaceState.keys()) {
    if (key.startsWith(CACHE_PREFIX)) {
      void workspaceState.update(key, undefined);
    }
  }
}

export async function searchIssues(
  config: JiraMiniConfig,
  jql: string,
  auth: JiraAuth,
  workspaceState: vscode.Memento,
  fields = 'summary,status,assignee,issuetype,project,priority,labels,parent',
  maxResults = config.maxResults,
): Promise<JiraSearchResult> {
  const base = apiBaseUrl(config, auth);
  const key = cacheKey(base, jql, maxResults);
  const cached = getCached<JiraSearchResult>(key, config.cacheTtlSeconds, workspaceState);
  if (cached) {
    return cached;
  }

  const attempts: Array<() => Promise<JiraSearchResult>> = [
    () => searchPost(base, `${CORE_REST_PREFIX}/search/jql`, jql, fields, maxResults, auth),
    () => searchGet(base, `${CORE_REST_PREFIX}/search/jql`, jql, fields, maxResults, auth),
    () => searchPost(base, `${CORE_REST_PREFIX}/search`, jql, fields, maxResults, auth),
    () => searchGet(base, `${CORE_REST_PREFIX}/search`, jql, fields, maxResults, auth),
  ];

  let lastError: unknown;
  for (const fn of attempts) {
    try {
      const result = await fn();
      setCache(key, result, workspaceState);
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function searchPost(
  baseUrl: string,
  path: string,
  jql: string,
  fields: string,
  maxResults: number,
  auth: JiraAuth,
): Promise<JiraSearchResult> {
  return jiraApiFetch<JiraSearchResult>(baseUrl, path, auth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql, fields: fields.split(','), maxResults }),
  });
}

async function searchGet(
  baseUrl: string,
  path: string,
  jql: string,
  fields: string,
  maxResults: number,
  auth: JiraAuth,
): Promise<JiraSearchResult> {
  const encoded = encodeURIComponent(jql);
  return jiraApiFetch<JiraSearchResult>(
    baseUrl,
    `${path}?jql=${encoded}&maxResults=${maxResults}&fields=${encodeURIComponent(fields)}`,
    auth,
  );
}

export async function getIssue(config: JiraMiniConfig, key: string, auth: JiraAuth): Promise<JiraIssue> {
  const base = apiBaseUrl(config, auth);
  const fields = 'summary,description,subtasks,labels,issuetype,project,priority,status,assignee,reporter,parent,created,updated,resolution,components,fixVersions,customfield_10016,story_points';
  return jiraApiFetch<JiraIssue>(base, `${CORE_REST_PREFIX}/issue/${encodeURIComponent(key)}?fields=${fields}`, auth);
}

export async function getBoards(config: JiraMiniConfig, auth: JiraAuth): Promise<JiraBoard[]> {
  const base = apiBaseUrl(config, auth);
  const data = await jiraApiFetch<JiraBoardsResponse>(base, `${AGILE_REST_PREFIX}/board`, auth);
  return data.values || [];
}

export async function getBoardBacklog(config: JiraMiniConfig, auth: JiraAuth, boardId: number): Promise<JiraIssue[]> {
  const base = apiBaseUrl(config, auth);
  const data = await jiraApiFetch<JiraSearchResult>(base, `${AGILE_REST_PREFIX}/board/${boardId}/backlog`, auth);
  return data.issues || [];
}

export async function getBoardSprints(config: JiraMiniConfig, auth: JiraAuth, boardId: number): Promise<JiraSprint[]> {
  const base = apiBaseUrl(config, auth);
  const data = await jiraApiFetch<JiraSprintsResponse>(
    base,
    `${AGILE_REST_PREFIX}/board/${boardId}/sprint?state=active,future,closed`,
    auth,
  );
  return data.values || [];
}

export async function getSprintIssues(
  config: JiraMiniConfig,
  auth: JiraAuth,
  boardId: number,
  sprintId: number,
): Promise<JiraIssue[]> {
  const base = apiBaseUrl(config, auth);
  const data = await jiraApiFetch<JiraSearchResult>(
    base,
    `${AGILE_REST_PREFIX}/board/${boardId}/sprint/${sprintId}/issue`,
    auth,
  );
  return data.issues || [];
}

export async function getBoardEpics(config: JiraMiniConfig, auth: JiraAuth, boardId: number): Promise<JiraEpic[]> {
  const base = apiBaseUrl(config, auth);
  const data = await jiraApiFetch<JiraEpicsResponse>(base, `${AGILE_REST_PREFIX}/board/${boardId}/epic`, auth);
  return data.values || [];
}

export async function getTransitions(config: JiraMiniConfig, key: string, auth: JiraAuth): Promise<JiraTransition[]> {
  const base = apiBaseUrl(config, auth);
  const data = await jiraApiFetch<JiraTransitionsResponse>(
    base,
    `${CORE_REST_PREFIX}/issue/${encodeURIComponent(key)}/transitions`,
    auth,
  );
  return data.transitions || [];
}

export async function doTransition(config: JiraMiniConfig, key: string, transitionId: string, auth: JiraAuth): Promise<void> {
  const base = apiBaseUrl(config, auth);
  const res = await fetch(`${base}${CORE_REST_PREFIX}/issue/${encodeURIComponent(key)}/transitions`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': authHeader(auth),
    },
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
  if (!res.ok) {
    const body = await safeBody(res);
    throw new Error(`Jira API status=${res.status} body=${body}`);
  }
}

let myselfCache: JiraUser | undefined;

export async function getMyself(config: JiraMiniConfig, auth: JiraAuth): Promise<JiraUser> {
  if (myselfCache) {
    return myselfCache;
  }
  const base = apiBaseUrl(config, auth);
  const user = await jiraApiFetch<JiraUser>(base, `${CORE_REST_PREFIX}/myself`, auth);
  myselfCache = user;
  return user;
}

export async function assignIssue(
  config: JiraMiniConfig,
  key: string,
  accountId: string | null,
  auth: JiraAuth,
): Promise<void> {
  const base = apiBaseUrl(config, auth);
  const res = await fetch(`${base}${CORE_REST_PREFIX}/issue/${encodeURIComponent(key)}/assignee`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': authHeader(auth),
    },
    body: JSON.stringify({ accountId }),
  });
  if (!res.ok) {
    const body = await safeBody(res);
    throw new Error(`Jira API status=${res.status} body=${body}`);
  }
}

export async function updateIssueFields(
  config: JiraMiniConfig,
  key: string,
  fields: Record<string, unknown>,
  auth: JiraAuth,
): Promise<void> {
  const base = apiBaseUrl(config, auth);
  const res = await fetch(`${base}${CORE_REST_PREFIX}/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': authHeader(auth),
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await safeBody(res);
    throw new Error(`Jira API status=${res.status} body=${body}`);
  }
}

export async function getPriorities(config: JiraMiniConfig, auth: JiraAuth): Promise<Array<{ id: string; name: string }>> {
  const base = apiBaseUrl(config, auth);
  return jiraApiFetch<Array<{ id: string; name: string }>>(base, `${CORE_REST_PREFIX}/priority`, auth);
}

async function jiraApiFetch<T>(baseUrl: string, resourcePath: string, auth: JiraAuth, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${resourcePath}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Authorization': authHeader(auth),
      ...(init?.headers || {}),
    },
  });
  return readJsonOrThrow<T>(res, 'Jira API');
}

async function readJsonOrThrow<T>(res: Response, source: string): Promise<T> {
  if (!res.ok) {
    const body = await safeBody(res);
    throw new Error(`${source} status=${res.status} body=${body}`);
  }
  return res.json() as Promise<T>;
}

async function safeBody(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    return txt || '<empty>';
  } catch {
    return '<unreadable>';
  }
}
