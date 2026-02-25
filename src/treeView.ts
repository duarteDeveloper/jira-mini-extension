import * as vscode from 'vscode';
import { JiraAuth, JiraBoard, JiraEpic, JiraIssue, JiraMiniConfig, JiraSprint } from './types';
import { getBoardBacklog, getBoardEpics, getBoards, getBoardSprints, getSprintIssues, searchIssues } from './jiraClient';

const STATE_SELECTED_BOARD_ID = 'jiraMini.selectedBoardId';
const STATE_SELECTED_BOARD_NAME = 'jiraMini.selectedBoardName';
const STATE_SELECTED_SPRINT_ID = 'jiraMini.selectedSprintId';

type CategoryNode = { type: 'category'; label: string; category: 'boards' };
type BoardNode = { type: 'board'; board: JiraBoard };
type SectionKind = 'backlog' | 'activeSprint' | 'sprints' | 'epics';
type SectionNode = { type: 'section'; section: SectionKind; boardId: number; label?: string };
type SprintNode = { type: 'sprint'; sprint: JiraSprint; boardId: number };
type EpicNode = { type: 'epic'; epic: JiraEpic };
type IssueNode = { type: 'issue'; issue: JiraIssue };
type ErrorNode = { type: 'agileError'; message: string };
type InfoNode = { type: 'info'; message: string };

export type TreeNode = CategoryNode | BoardNode | SectionNode | SprintNode | EpicNode | IssueNode | ErrorNode | InfoNode;

function issueTypeIcon(name: string | undefined): vscode.ThemeIcon {
  switch ((name ?? '').toLowerCase()) {
    case 'epic': return new vscode.ThemeIcon('milestone', new vscode.ThemeColor('charts.purple'));
    case 'story': return new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.blue'));
    case 'task': return new vscode.ThemeIcon('tasklist', new vscode.ThemeColor('charts.green'));
    case 'sub-task':
    case 'subtask': return new vscode.ThemeIcon('indent', new vscode.ThemeColor('charts.gray'));
    case 'bug': return new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red'));
    default: return new vscode.ThemeIcon('issues');
  }
}

export class JiraMiniTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _allowedProjects = new Set<string>();

  constructor(
    private getAuthFn: () => Promise<JiraAuth | undefined>,
    private getConfigFn: () => JiraMiniConfig,
    private workspaceState: vscode.Memento,
  ) {}

  refresh(): void {
    this._allowedProjects.clear();
    this._onDidChangeTreeData.fire();
  }

  getAllowedProjects(): Set<string> {
    return this._allowedProjects;
  }

  getSelectedBoardId(): number | undefined {
    return this.workspaceState.get<number>(STATE_SELECTED_BOARD_ID);
  }

  getSelectedBoardName(): string | undefined {
    return this.workspaceState.get<string>(STATE_SELECTED_BOARD_NAME);
  }

  getSelectedSprintId(): number | undefined {
    return this.workspaceState.get<number>(STATE_SELECTED_SPRINT_ID);
  }

  async setSelectedBoard(board: JiraBoard): Promise<void> {
    await this.workspaceState.update(STATE_SELECTED_BOARD_ID, board.id);
    await this.workspaceState.update(STATE_SELECTED_BOARD_NAME, board.name);
    await this.workspaceState.update(STATE_SELECTED_SPRINT_ID, undefined);
    this._allowedProjects.clear();
    this.refresh();
  }

  async setSelectedSprint(sprintId: number | undefined): Promise<void> {
    await this.workspaceState.update(STATE_SELECTED_SPRINT_ID, sprintId);
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === 'category') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('project');
      item.contextValue = 'category';
      return item;
    }
    if (element.type === 'board') {
      const item = new vscode.TreeItem(element.board.name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('list-tree');
      item.description = `#${element.board.id}`;
      item.contextValue = 'board';
      return item;
    }
    if (element.type === 'section') {
      const labels: Record<SectionKind, string> = {
        backlog: 'Backlog',
        activeSprint: 'Sprint Active',
        sprints: 'Sprints (Future/Closed)',
        epics: 'Epics',
      };
      const iconMap: Record<SectionKind, string> = {
        backlog: 'inbox',
        activeSprint: 'flame',
        sprints: 'history',
        epics: 'milestone',
      };
      const item = new vscode.TreeItem(labels[element.section], vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'section';
      item.iconPath = new vscode.ThemeIcon(iconMap[element.section]);
      return item;
    }
    if (element.type === 'sprint') {
      const item = new vscode.TreeItem(element.sprint.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'sprint';
      item.description = element.sprint.state;
      item.iconPath = new vscode.ThemeIcon('rocket');
      return item;
    }
    if (element.type === 'epic') {
      const item = new vscode.TreeItem(element.epic.name || element.epic.key || String(element.epic.id), vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'epic';
      item.description = element.epic.key;
      item.iconPath = new vscode.ThemeIcon('milestone', new vscode.ThemeColor('charts.purple'));
      return item;
    }
    if (element.type === 'agileError') {
      const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('warning');
      item.contextValue = 'agileError';
      item.command = { command: 'jiraMini.search', title: 'Search JQL' };
      return item;
    }
    if (element.type === 'info') {
      const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'info';
      return item;
    }

    const issue = element.issue;
    const typeName = issue.fields.issuetype?.name ?? '';
    const item = new vscode.TreeItem(`${issue.key} — ${issue.fields.summary}`, vscode.TreeItemCollapsibleState.None);
    item.description = [typeName, issue.fields.status?.name, issue.fields.assignee?.displayName || 'Unassigned']
      .filter(Boolean).join(' · ');
    item.contextValue = 'issue';
    item.iconPath = issueTypeIcon(typeName);
    item.command = { command: 'jiraMini.openIssuePanel', title: 'Open Issue', arguments: [issue.key] };
    return item;
  }

  private trackProjects(issues: JiraIssue[]): void {
    for (const issue of issues) {
      const pk = issue.fields.project?.key;
      if (pk) {
        this._allowedProjects.add(pk);
      }
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      return [{ type: 'category', label: 'Boards', category: 'boards' }];
    }

    if (element.type === 'category') {
      const selectedBoardId = this.getSelectedBoardId();
      const selectedBoardName = this.getSelectedBoardName();
      if (!selectedBoardId || !selectedBoardName) {
        return [{ type: 'info', message: 'No selected board. Run "Jira Mini: Pick Board".' }];
      }
      return [{ type: 'board', board: { id: selectedBoardId, name: selectedBoardName } }];
    }

    if (element.type === 'board') {
      return [
        { type: 'section', section: 'backlog', boardId: element.board.id },
        { type: 'section', section: 'activeSprint', boardId: element.board.id },
        { type: 'section', section: 'sprints', boardId: element.board.id },
        { type: 'section', section: 'epics', boardId: element.board.id },
      ];
    }

    if (element.type === 'section') {
      const auth = await this.getAuthFn();
      if (!auth) {
        return [];
      }
      const config = this.getConfigFn();
      try {
        if (element.section === 'backlog') {
          const issues = await getBoardBacklog(config, auth, element.boardId);
          this.trackProjects(issues);
          return issues.map(issue => ({ type: 'issue' as const, issue }));
        }
        if (element.section === 'activeSprint') {
          const sprints = await getBoardSprints(config, auth, element.boardId);
          const active = sprints.find(s => s.state === 'active');
          if (!active) {
            return [{ type: 'info', message: 'No active sprint.' }];
          }
          await this.setSelectedSprint(active.id);
          const issues = await getSprintIssues(config, auth, element.boardId, active.id);
          this.trackProjects(issues);
          return issues.map(issue => ({ type: 'issue' as const, issue }));
        }
        if (element.section === 'sprints') {
          const sprints = await getBoardSprints(config, auth, element.boardId);
          return sprints
            .filter(s => s.state === 'future' || s.state === 'closed')
            .map(sprint => ({ type: 'sprint' as const, sprint, boardId: element.boardId }));
        }
        const epics = await getBoardEpics(config, auth, element.boardId);
        return epics.map(epic => ({ type: 'epic' as const, epic }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('status=400') || msg.includes('status=403') || msg.includes('status=404')) {
          return [{ type: 'agileError', message: 'Agile endpoint failed (400/403/404). Use Search JQL fallback.' }];
        }
        return [{ type: 'agileError', message: msg }];
      }
    }

    if (element.type === 'sprint') {
      const auth = await this.getAuthFn();
      if (!auth) {
        return [];
      }
      const config = this.getConfigFn();
      await this.setSelectedSprint(element.sprint.id);
      const issues = await getSprintIssues(config, auth, element.boardId, element.sprint.id);
      this.trackProjects(issues);
      return issues.map(issue => ({ type: 'issue' as const, issue }));
    }

    if (element.type === 'epic') {
      const auth = await this.getAuthFn();
      if (!auth) {
        return [];
      }
      if (!element.epic.key) {
        return [{ type: 'info', message: 'Epic key unavailable for this board item.' }];
      }
      const config = this.getConfigFn();
      const key = element.epic.key.trim().toUpperCase();
      const jql = `(parent = ${key} OR "Epic Link" = ${key}) AND statusCategory != Done ORDER BY updated DESC`;
      const result = await searchIssues(config, jql, auth, this.workspaceState);
      this.trackProjects(result.issues);
      return result.issues.map(issue => ({ type: 'issue' as const, issue }));
    }

    return [];
  }

  async loadBoards(): Promise<JiraBoard[]> {
    const auth = await this.getAuthFn();
    if (!auth) {
      return [];
    }
    return getBoards(this.getConfigFn(), auth);
  }
}
