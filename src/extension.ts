import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { JiraAuth, JiraIssue, SddProviderOutput } from './types';
import {
  assignIssue,
  browseBaseUrl,
  clearCache,
  doTransition,
  getAuth,
  getBoardBacklog,
  getBoardSprints,
  getConfig,
  getIssue,
  getMyself,
  getPriorities,
  getSprintIssues,
  getTransitions,
  oauthAccessibleResources,
  oauthExchangeToken,
  searchIssues,
  testBasicConnection,
  updateIssueFields,
} from './jiraClient';
import { JiraMiniTreeProvider, TreeNode } from './treeView';
import { extractTasks } from './sdd';
import { resolveSddProvider } from './sdd/providers';
import { adfToHtml, adfToMarkdownText } from './adf';
import { IssuePanel, IssuePayload } from './ui/issuePanel';
import { JiraMiniConfig } from './types';

const lastTransition = new Map<string, string>();

function buildIssuePayload(issue: JiraIssue, descHtml: string): IssuePayload {
  const f = issue.fields;
  const sp = f.customfield_10016 ?? f.story_points ?? null;
  return {
    key: issue.key,
    summary: f.summary ?? '',
    status: f.status?.name ?? '',
    statusCategory: f.status?.statusCategory?.name ?? '',
    assignee: f.assignee?.displayName ?? 'Unassigned',
    reporter: f.reporter?.displayName ?? '',
    priority: f.priority?.name ?? '',
    issueType: f.issuetype?.name ?? '',
    labels: f.labels ?? [],
    descriptionHtml: descHtml,
    subtasks: (f.subtasks ?? []).map(s => ({
      key: s.key,
      summary: s.fields.summary ?? '',
      status: s.fields.status?.name ?? '',
    })),
    projectKey: f.project?.key ?? '',
    projectName: f.project?.name ?? '',
    parentKey: f.parent?.key ?? '',
    parentSummary: f.parent?.fields?.summary ?? '',
    storyPoints: typeof sp === 'number' ? sp : null,
    created: f.created ?? '',
    updated: f.updated ?? '',
    resolution: f.resolution?.name ?? '',
    components: (f.components ?? []).map(c => c.name),
    fixVersions: (f.fixVersions ?? []).map(v => v.name),
  };
}

async function refreshPanel(
  panel: IssuePanel,
  config: JiraMiniConfig,
  key: string,
  auth: JiraAuth,
): Promise<void> {
  const refreshed = await getIssue(config, key, auth);
  const html = adfToHtml(refreshed.fields.description);
  panel.setTitle(`${refreshed.key} — ${refreshed.fields.summary ?? ''}`);
  panel.render(buildIssuePayload(refreshed, html));
}

export function activate(context: vscode.ExtensionContext) {
  const secrets = context.secrets;
  const workspaceState = context.workspaceState;
  const authFn = () => getAuth(secrets);
  const configFn = () => getConfig();

  const treeProvider = new JiraMiniTreeProvider(authFn, configFn, workspaceState);
  const treeView = vscode.window.createTreeView('jiraMini.issuesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  const boardStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  boardStatus.command = 'jiraMini.pickBoard';
  boardStatus.tooltip = 'Pick Jira board';
  boardStatus.show();
  context.subscriptions.push(boardStatus);

  const sddStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  sddStatus.text = '$(book) SDD';
  sddStatus.tooltip = 'SDD from issue key';
  sddStatus.command = 'jiraMini.sddFromKey';
  sddStatus.show();
  context.subscriptions.push(sddStatus);

  const updateBoardStatus = () => {
    const name = treeProvider.getSelectedBoardName();
    boardStatus.text = `$(list-tree) Board: ${name || 'None'}`;
  };
  updateBoardStatus();
  context.subscriptions.push(treeProvider.onDidChangeTreeData(updateBoardStatus));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.open', async () => {
    const pick = await vscode.window.showQuickPick([
      { label: 'Connect...', command: 'jiraMini.connect' },
      { label: 'Pick Board', command: 'jiraMini.pickBoard' },
      { label: 'Backlog (Selected Board)', command: 'jiraMini.backlogSelectedBoard' },
      { label: 'Active Sprint (Selected Board)', command: 'jiraMini.activeSprintSelectedBoard' },
      { label: 'Search (JQL)', command: 'jiraMini.search' },
      { label: 'SDD from Issue Key', command: 'jiraMini.sddFromKey' },
    ], { placeHolder: 'Jira Mini actions' });
    if (pick) {
      await vscode.commands.executeCommand(pick.command);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.connect', async () => {
    const mode = await vscode.window.showQuickPick([
      { label: 'API Token (Basic Auth)', value: 'basic' as const },
      { label: 'OAuth (3LO) (experimental)', value: 'oauth' as const },
    ], { placeHolder: 'Choose Jira authentication mode' });
    if (!mode) {
      return;
    }
    if (mode.value === 'basic') {
      await runBasicConnectWizard(context);
      treeProvider.refresh();
      return;
    }
    await runOAuthConnectWizard(context);
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.setAuth', async () => {
    await vscode.commands.executeCommand('jiraMini.connect');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.pickBoard', async () => {
    try {
      const boards = await treeProvider.loadBoards();
      if (boards.length === 0) {
        vscode.window.showInformationMessage('Jira Mini: no boards found for this account.');
        return;
      }
      const selected = await vscode.window.showQuickPick(
        boards.map(b => ({ label: b.name, description: `#${b.id} ${b.type || ''}`.trim(), board: b })),
        { placeHolder: 'Select Jira board' },
      );
      if (!selected) {
        return;
      }
      await treeProvider.setSelectedBoard(selected.board);
      vscode.window.showInformationMessage(`Jira Mini: selected board "${selected.board.name}".`);
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.backlogSelectedBoard', async () => {
    const boardId = treeProvider.getSelectedBoardId();
    if (!boardId) {
      vscode.window.showWarningMessage('Jira Mini: pick a board first.');
      return;
    }
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const config = configFn();
    try {
      const issues = await getBoardBacklog(config, auth, boardId);
      await pickIssueAndOpen(config, auth, issues);
    } catch (err) {
      const msg = toErrorMessage(err);
      if (isAgileFallbackStatus(msg)) {
        const act = await vscode.window.showErrorMessage(`${msg}. Use Search JQL fallback?`, 'Search JQL');
        if (act === 'Search JQL') {
          await vscode.commands.executeCommand('jiraMini.search');
        }
        return;
      }
      vscode.window.showErrorMessage(msg);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.activeSprintSelectedBoard', async () => {
    const boardId = treeProvider.getSelectedBoardId();
    if (!boardId) {
      vscode.window.showWarningMessage('Jira Mini: pick a board first.');
      return;
    }
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const config = configFn();
    try {
      const sprints = await getBoardSprints(config, auth, boardId);
      const active = sprints.find(s => s.state === 'active');
      if (!active) {
        vscode.window.showInformationMessage('Jira Mini: no active sprint for selected board.');
        return;
      }
      await treeProvider.setSelectedSprint(active.id);
      const issues = await getSprintIssues(config, auth, boardId, active.id);
      await pickIssueAndOpen(config, auth, issues);
    } catch (err) {
      const msg = toErrorMessage(err);
      if (isAgileFallbackStatus(msg)) {
        const act = await vscode.window.showErrorMessage(`${msg}. Use Search JQL fallback?`, 'Search JQL');
        if (act === 'Search JQL') {
          await vscode.commands.executeCommand('jiraMini.search');
        }
        return;
      }
      vscode.window.showErrorMessage(msg);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.searchProjectOpen', async () => {
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const config = configFn();
    const input = await vscode.window.showInputBox({
      prompt: 'Project key(s), comma separated',
      placeHolder: 'ABC,XYZ',
      ignoreFocusOut: true,
    });
    if (!input) {
      return;
    }
    const keys = input.split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
    if (keys.length === 0) {
      return;
    }
    const jql = `project in (${keys.join(',')}) AND statusCategory != Done ORDER BY updated DESC`;
    await searchAndPick(config, jql, auth, workspaceState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.search', async () => {
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const config = configFn();
    const jql = await vscode.window.showInputBox({
      prompt: 'Enter JQL query',
      value: config.defaultJql,
      ignoreFocusOut: true,
    });
    if (!jql) {
      return;
    }
    await searchAndPick(config, jql, auth, workspaceState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.myOpen', async () => {
    const auth = await authFn();
    if (!auth) {
      return;
    }
    await searchAndPick(configFn(), 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC', auth, workspaceState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.currentSprint', async () => {
    const auth = await authFn();
    if (!auth) {
      return;
    }
    await searchAndPick(configFn(), 'assignee = currentUser() AND sprint in openSprints() AND statusCategory != Done ORDER BY updated DESC', auth, workspaceState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.byEpic', async () => {
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const epicKey = await vscode.window.showInputBox({ prompt: 'Enter Epic key (e.g. ABC-123)', placeHolder: 'PROJECT-123' });
    if (!epicKey) {
      return;
    }
    const key = epicKey.trim().toUpperCase();
    await searchAndPick(configFn(), `(parent = ${key} OR "Epic Link" = ${key}) AND statusCategory != Done ORDER BY updated DESC`, auth, workspaceState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.byLabel', async () => {
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const label = await vscode.window.showInputBox({ prompt: 'Enter label name', placeHolder: 'my-label' });
    if (!label) {
      return;
    }
    await searchAndPick(configFn(), `labels = "${label.trim()}" ORDER BY updated DESC`, auth, workspaceState);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.clearCache', () => {
    clearCache(workspaceState);
    treeProvider.refresh();
    vscode.window.showInformationMessage('Jira Mini: Cache cleared.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.refreshTree', () => {
    treeProvider.refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.openInBrowser', async (node?: TreeNode) => {
    if (!node || node.type !== 'issue') {
      return;
    }
    const auth = await authFn();
    if (!auth) {
      return;
    }
    const config = configFn();
    const base = browseBaseUrl(config, auth);
    await vscode.env.openExternal(vscode.Uri.parse(`${base}/browse/${node.issue.key}`));
  }));

  async function checkProjectScope(issue: JiraIssue): Promise<boolean> {
    const allowed = treeProvider.getAllowedProjects();
    if (allowed.size === 0) {
      return true;
    }
    const pk = issue.fields.project?.key;
    if (!pk || allowed.has(pk)) {
      return true;
    }
    const answer = await vscode.window.showWarningMessage(
      `Issue ${issue.key} belongs to project "${pk}", which is outside the current board scope (${[...allowed].join(', ')}). Continue?`,
      { modal: true },
      'Yes',
    );
    return answer === 'Yes';
  }

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.openIssuePanel', async (key: string) => {
    if (!key) {
      return;
    }
    try {
      const auth = await authFn();
      if (!auth) {
        return;
      }
      const config = configFn();
      const base = browseBaseUrl(config, auth);
      const issue = await getIssue(config, key, auth);
      if (!(await checkProjectScope(issue))) {
        return;
      }
      const descriptionHtml = adfToHtml(issue.fields.description);

      const panel = IssuePanel.show(context);
      panel.setTitle(`${issue.key} — ${issue.fields.summary ?? ''}`);
      panel.render(buildIssuePayload(issue, descriptionHtml));

      const msgDisposable = panel.onMessage(async (msg) => {
        if (msg.type === 'openInJira' && msg.key) {
          await vscode.env.openExternal(vscode.Uri.parse(`${base}/browse/${msg.key}`));
        } else if (msg.type === 'openIssue' && msg.key) {
          msgDisposable.dispose();
          await vscode.commands.executeCommand('jiraMini.openIssuePanel', msg.key);
        } else if (msg.type === 'sdd' && msg.key) {
          await vscode.commands.executeCommand('jiraMini.sddFromKey');
        } else if (msg.type === 'solveInChat' && msg.key) {
          const specInfo = await buildIssueSummaryForChat(config, issue, base);
          await sendToCursorChat(specInfo);
        } else if (msg.type === 'transition' && msg.key) {
          try {
            const currentIssue = await getIssue(config, msg.key, auth);
            const prevStatus = currentIssue.fields.status?.name ?? '';
            const transitions = await getTransitions(config, msg.key, auth);
            if (transitions.length === 0) {
              vscode.window.showInformationMessage('Jira Mini: No transitions available for this issue.');
              return;
            }
            const pick = await vscode.window.showQuickPick(
              transitions.map(t => ({ label: t.name, description: `→ ${t.to.name}`, id: t.id })),
              { placeHolder: `Move ${msg.key} to...` },
            );
            if (!pick) {
              return;
            }
            await doTransition(config, msg.key, pick.id, auth);
            if (prevStatus) {
              lastTransition.set(msg.key, prevStatus);
            }
            await refreshPanel(panel, config, msg.key, auth);
            treeProvider.refresh();
            const action = await vscode.window.showInformationMessage(
              `Jira Mini: ${msg.key} moved to "${pick.label}".`,
              'Undo',
            );
            if (action === 'Undo') {
              await vscode.commands.executeCommand('jiraMini.undoTransition', msg.key);
              await refreshPanel(panel, config, msg.key, auth);
            }
          } catch (err) {
            vscode.window.showErrorMessage(toErrorMessage(err));
          }
        } else if (msg.type === 'assignToMe' && msg.key) {
          try {
            const me = await getMyself(config, auth);
            if (!me.accountId) {
              vscode.window.showErrorMessage('Jira Mini: Could not determine your account ID.');
              return;
            }
            await assignIssue(config, msg.key, me.accountId, auth);
            await refreshPanel(panel, config, msg.key, auth);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Jira Mini: ${msg.key} assigned to ${me.displayName ?? 'you'}.`);
          } catch (err) {
            vscode.window.showErrorMessage(toErrorMessage(err));
          }
        } else if (msg.type === 'unassign' && msg.key) {
          try {
            await assignIssue(config, msg.key, null, auth);
            await refreshPanel(panel, config, msg.key, auth);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Jira Mini: ${msg.key} unassigned.`);
          } catch (err) {
            vscode.window.showErrorMessage(toErrorMessage(err));
          }
        } else if (msg.type === 'editStoryPoints' && msg.key) {
          try {
            const input = await vscode.window.showInputBox({
              prompt: `Story Points for ${msg.key}`,
              placeHolder: 'Enter a number (or leave empty to clear)',
              validateInput: v => {
                if (v === '') { return null; }
                const n = Number(v);
                if (isNaN(n) || n < 0) { return 'Enter a valid non-negative number'; }
                return null;
              },
            });
            if (input === undefined) { return; }
            const sp = input === '' ? null : Number(input);
            await updateIssueFields(config, msg.key, { customfield_10016: sp }, auth);
            await refreshPanel(panel, config, msg.key, auth);
            vscode.window.showInformationMessage(`Jira Mini: ${msg.key} story points updated.`);
          } catch (err) {
            vscode.window.showErrorMessage(toErrorMessage(err));
          }
        } else if (msg.type === 'editPriority' && msg.key) {
          try {
            const priorities = await getPriorities(config, auth);
            if (priorities.length === 0) {
              vscode.window.showInformationMessage('Jira Mini: No priorities available.');
              return;
            }
            const pick = await vscode.window.showQuickPick(
              priorities.map(p => ({ label: p.name, id: p.id })),
              { placeHolder: `Set priority for ${msg.key}` },
            );
            if (!pick) { return; }
            await updateIssueFields(config, msg.key, { priority: { id: pick.id } }, auth);
            await refreshPanel(panel, config, msg.key, auth);
            treeProvider.refresh();
            vscode.window.showInformationMessage(`Jira Mini: ${msg.key} priority set to "${pick.label}".`);
          } catch (err) {
            vscode.window.showErrorMessage(toErrorMessage(err));
          }
        }
      });
      context.subscriptions.push(msgDisposable);
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.transitionIssue', async (node?: TreeNode) => {
    const key = node && node.type === 'issue' ? node.issue.key : undefined;
    if (!key) {
      return;
    }
    try {
      const auth = await authFn();
      if (!auth) {
        return;
      }
      const config = configFn();
      const currentIssue = await getIssue(config, key, auth);
      const prevStatus = currentIssue.fields.status?.name ?? '';
      const transitions = await getTransitions(config, key, auth);
      if (transitions.length === 0) {
        vscode.window.showInformationMessage('Jira Mini: No transitions available for this issue.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        transitions.map(t => ({ label: t.name, description: `→ ${t.to.name}`, id: t.id })),
        { placeHolder: `Move ${key} to...` },
      );
      if (!pick) {
        return;
      }
      await doTransition(config, key, pick.id, auth);
      if (prevStatus) {
        lastTransition.set(key, prevStatus);
      }
      treeProvider.refresh();
      const action = await vscode.window.showInformationMessage(
        `Jira Mini: ${key} moved to "${pick.label}".`,
        'Undo',
      );
      if (action === 'Undo') {
        await vscode.commands.executeCommand('jiraMini.undoTransition', key);
      }
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.undoTransition', async (key?: string) => {
    if (!key) {
      return;
    }
    const previousStatus = lastTransition.get(key);
    if (!previousStatus) {
      vscode.window.showInformationMessage('Jira Mini: No transition to undo.');
      return;
    }
    try {
      const auth = await authFn();
      if (!auth) { return; }
      const config = configFn();
      const transitions = await getTransitions(config, key, auth);
      const match = transitions.find(t => t.to.name.toLowerCase() === previousStatus.toLowerCase());
      if (!match) {
        vscode.window.showWarningMessage(
          `Jira Mini: Cannot undo — no transition back to "${previousStatus}" is available in the current workflow.`,
        );
        return;
      }
      await doTransition(config, key, match.id, auth);
      lastTransition.delete(key);
      vscode.window.showInformationMessage(`Jira Mini: ${key} reverted to "${previousStatus}".`);
      treeProvider.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.assignToMe', async (node?: TreeNode) => {
    const key = node && node.type === 'issue' ? node.issue.key : undefined;
    if (!key) {
      return;
    }
    try {
      const auth = await authFn();
      if (!auth) { return; }
      const config = configFn();
      const me = await getMyself(config, auth);
      if (!me.accountId) {
        vscode.window.showErrorMessage('Jira Mini: Could not determine your account ID.');
        return;
      }
      await assignIssue(config, key, me.accountId, auth);
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Jira Mini: ${key} assigned to ${me.displayName ?? 'you'}.`);
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.solveSelected', async () => {
    const selected = treeView.selection.filter((n): n is TreeNode & { type: 'issue' } => n.type === 'issue');
    if (selected.length === 0) {
      vscode.window.showWarningMessage('Jira Mini: select one or more issues in the tree first.');
      return;
    }
    try {
      const auth = await authFn();
      if (!auth) {
        return;
      }
      const config = configFn();
      const base = browseBaseUrl(config, auth);

      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Jira Mini: Building batch summary...' }, async () => {
        const parts: string[] = [`# Batch: ${selected.length} issue(s)\n`];
        for (const node of selected) {
          const issue = await getIssue(config, node.issue.key, auth);
          const summary = await buildIssueSummaryForChat(config, issue, base);
          parts.push(summary, '\n---\n');
        }
        parts.push('Please implement/solve ALL the issues above, following SDD if specs are present.');
        await sendToCursorChat(parts.join('\n'));
      });
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.solveSection', async (node?: TreeNode) => {
    if (!node || (node.type !== 'section' && node.type !== 'sprint')) {
      vscode.window.showWarningMessage('Jira Mini: run this on a Backlog, Sprint, or Sprint section.');
      return;
    }
    try {
      const auth = await authFn();
      if (!auth) {
        return;
      }
      const config = configFn();
      const base = browseBaseUrl(config, auth);

      const children = await treeProvider.getChildren(node);
      const issueNodes = children.filter((n): n is TreeNode & { type: 'issue' } => n.type === 'issue');
      if (issueNodes.length === 0) {
        vscode.window.showInformationMessage('Jira Mini: no issues in this section.');
        return;
      }

      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Jira Mini: Building batch summary...' }, async () => {
        const label = node.type === 'sprint' ? node.sprint.name : node.section;
        const parts: string[] = [`# Batch: ${issueNodes.length} issue(s) from ${label}\n`];
        for (const n of issueNodes) {
          const issue = await getIssue(config, n.issue.key, auth);
          const summary = await buildIssueSummaryForChat(config, issue, base);
          parts.push(summary, '\n---\n');
        }
        parts.push('Please implement/solve ALL the issues above, following SDD if specs are present.');
        await sendToCursorChat(parts.join('\n'));
      });
    } catch (err) {
      vscode.window.showErrorMessage(toErrorMessage(err));
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.sddSpec', async (node?: TreeNode) => {
    try {
      const key = await resolveIssueKey(node);
      if (!key) {
        return;
      }
      const gen = await generateSddForIssue(context, key);
      const specPath = await writeOutputFile(context, gen.output.spec, gen.config.sddNeverOverwrite);
      await openFileInEditor(specPath);
      vscode.window.showInformationMessage(`Jira Mini: generated ${path.basename(specPath)} for ${key}.`);
    } catch (err) {
      if (!isCancelledError(err)) {
        vscode.window.showErrorMessage(toErrorMessage(err));
      }
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.sddPlan', async (node?: TreeNode) => {
    try {
      const key = await resolveIssueKey(node);
      if (!key) {
        return;
      }
      const gen = await generateSddForIssue(context, key);
      const planPath = await writeOutputFile(context, gen.output.plan, gen.config.sddNeverOverwrite);
      for (const extra of gen.output.extras) {
        await writeOutputFile(context, extra, gen.config.sddNeverOverwrite);
      }
      await openFileInEditor(planPath);
      vscode.window.showInformationMessage(`Jira Mini: generated plan for ${key}.`);
    } catch (err) {
      if (!isCancelledError(err)) {
        vscode.window.showErrorMessage(toErrorMessage(err));
      }
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.sddCopyPrompt', async (node?: TreeNode) => {
    try {
      const key = await resolveIssueKey(node);
      if (!key) {
        return;
      }
      const gen = await generateSddForIssue(context, key);
      const spec = await ensureFileAndRead(context, gen.output.spec, gen.config.sddNeverOverwrite);
      const plan = await ensureFileAndRead(context, gen.output.plan, gen.config.sddNeverOverwrite);
      const prompt = gen.provider.buildPlanPrompt(key, spec, plan, gen.baseBrowseUrl);
      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage('Jira Mini: plan prompt copied to clipboard.');
    } catch (err) {
      if (!isCancelledError(err)) {
        vscode.window.showErrorMessage(toErrorMessage(err));
      }
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('jiraMini.sddFromKey', async (node?: TreeNode) => {
    try {
      const key = await resolveIssueKey(node);
      if (!key) {
        return;
      }
      const gen = await generateSddForIssue(context, key);
      const specPath = await writeOutputFile(context, gen.output.spec, gen.config.sddNeverOverwrite);
      const planPath = await writeOutputFile(context, gen.output.plan, gen.config.sddNeverOverwrite);
      for (const extra of gen.output.extras) {
        await writeOutputFile(context, extra, gen.config.sddNeverOverwrite);
      }
      await openFileInEditor(specPath);
      await openFileInEditor(planPath);
      const prompt = gen.provider.buildPlanPrompt(key, gen.output.spec.content, gen.output.plan.content, gen.baseBrowseUrl);
      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage(`Jira Mini: SDD files generated for ${key}. Prompt copied.`);
    } catch (err) {
      if (!isCancelledError(err)) {
        vscode.window.showErrorMessage(toErrorMessage(err));
      }
    }
  }));
}

export function deactivate() {}

async function resolveIssueKey(node?: TreeNode): Promise<string | undefined> {
  if (node && node.type === 'issue') {
    return node.issue.key;
  }
  const input = await vscode.window.showInputBox({
    prompt: 'Enter Jira issue key (e.g. ABC-123)',
    placeHolder: 'PROJECT-123',
    ignoreFocusOut: true,
  });
  return input ? input.trim().toUpperCase() : undefined;
}

async function searchAndPick(
  config: ReturnType<typeof getConfig>,
  jql: string,
  auth: JiraAuth,
  workspaceState: vscode.Memento,
): Promise<void> {
  const result = await searchIssues(config, jql, auth, workspaceState);
  await pickIssueAndOpen(config, auth, result.issues);
}

async function pickIssueAndOpen(config: ReturnType<typeof getConfig>, auth: JiraAuth, issues: JiraIssue[]): Promise<void> {
  if (issues.length === 0) {
    vscode.window.showInformationMessage('Jira Mini: no issues found.');
    return;
  }
  const pick = await vscode.window.showQuickPick(issues.map(issue => ({
    label: `${issue.key} — ${issue.fields.summary}`,
    description: `${issue.fields.status?.name || '?'} • ${issue.fields.assignee?.displayName || 'Unassigned'}`,
    issue,
  })), { placeHolder: `${issues.length} issue(s) found` });
  if (!pick) {
    return;
  }
  const base = browseBaseUrl(config, auth);
  await vscode.env.openExternal(vscode.Uri.parse(`${base}/browse/${pick.issue.key}`));
}

async function runBasicConnectWizard(context: vscode.ExtensionContext): Promise<void> {
  const cfg = getConfig();
  const baseUrlInput = await vscode.window.showInputBox({
    prompt: 'Jira base URL',
    placeHolder: 'https://your-domain.atlassian.net',
    value: cfg.baseUrl,
    ignoreFocusOut: true,
  });
  if (!baseUrlInput) {
    return;
  }
  const baseUrl = normalizeBaseUrl(baseUrlInput);
  if (!baseUrl) {
    vscode.window.showErrorMessage('Jira Mini: invalid baseUrl. Use https://<site>.atlassian.net');
    return;
  }
  const email = await vscode.window.showInputBox({
    prompt: 'Jira account email',
    placeHolder: 'you@company.com',
    ignoreFocusOut: true,
  });
  if (!email) {
    return;
  }
  const token = await vscode.window.showInputBox({
    prompt: 'Jira API token',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) {
    return;
  }
  await testBasicConnection(baseUrl, email.trim(), token.trim());
  const wsCfg = vscode.workspace.getConfiguration('jiraMini');
  await wsCfg.update('baseUrl', baseUrl, vscode.ConfigurationTarget.Workspace);
  await wsCfg.update('authMode', 'basic', vscode.ConfigurationTarget.Workspace);
  await context.secrets.store('jiraMini.email', email.trim());
  await context.secrets.store('jiraMini.token', token.trim());
  vscode.window.showInformationMessage('Jira Mini: Basic auth connected successfully.');
}

async function runOAuthConnectWizard(context: vscode.ExtensionContext): Promise<void> {
  const cfg = getConfig();
  const clientId = await vscode.window.showInputBox({
    prompt: 'Atlassian OAuth client_id',
    value: cfg.oauthClientId || '',
    ignoreFocusOut: true,
  });
  if (!clientId) {
    return;
  }
  const scopes = await vscode.window.showInputBox({
    prompt: 'OAuth scopes (space separated)',
    value: cfg.oauthScopes,
    ignoreFocusOut: true,
  });
  if (!scopes) {
    return;
  }

  const wsCfg = vscode.workspace.getConfiguration('jiraMini');
  await wsCfg.update('oauthClientId', clientId.trim(), vscode.ConfigurationTarget.Workspace);
  await wsCfg.update('oauthScopes', scopes.trim(), vscode.ConfigurationTarget.Workspace);

  const codeVerifier = randomUrlSafe(64);
  const challenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
  const state = randomUrlSafe(16);
  const callbackState = createOAuthUriHandler(state);
  context.subscriptions.push(callbackState.registration);

  const internalRedirect = vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}/oauth-callback`);
  const externalRedirect = await vscode.env.asExternalUri(internalRedirect);
  const redirect = encodeURIComponent(externalRedirect.toString(true));
  const authUrl = `https://auth.atlassian.com/authorize?audience=${encodeURIComponent(cfg.oauthAudience)}&client_id=${encodeURIComponent(clientId.trim())}&scope=${encodeURIComponent(scopes.trim())}&redirect_uri=${redirect}&state=${encodeURIComponent(state)}&response_type=code&prompt=consent&code_challenge_method=S256&code_challenge=${encodeURIComponent(challenge)}`;
  await vscode.env.openExternal(vscode.Uri.parse(authUrl));

  const code = await callbackState.waitForCode();
  const token = await oauthExchangeToken({
    clientId: clientId.trim(),
    code,
    codeVerifier,
    redirectUri: externalRedirect.toString(true),
  });
  const resources = await oauthAccessibleResources(token.access_token);
  if (resources.length === 0) {
    throw new Error('No accessible Jira resources found for this OAuth token.');
  }
  const selected = await vscode.window.showQuickPick(resources.map(r => ({
    label: r.name,
    description: r.url,
    resource: r,
  })), { placeHolder: 'Select Jira site for OAuth requests' });
  if (!selected) {
    return;
  }

  await wsCfg.update('authMode', 'oauth', vscode.ConfigurationTarget.Workspace);
  await wsCfg.update('baseUrl', selected.resource.url.replace(/\/+$/, ''), vscode.ConfigurationTarget.Workspace);
  await context.secrets.store('jiraMini.oauth.accessToken', token.access_token);
  if (token.refresh_token) {
    await context.secrets.store('jiraMini.oauth.refreshToken', token.refresh_token);
  }
  await context.secrets.store('jiraMini.oauth.cloudId', selected.resource.id);
  await context.secrets.store('jiraMini.oauth.siteUrl', selected.resource.url.replace(/\/+$/, ''));
  vscode.window.showInformationMessage(`Jira Mini: OAuth connected to ${selected.resource.name}.`);
}

function createOAuthUriHandler(expectedState: string): {
  registration: vscode.Disposable;
  waitForCode: () => Promise<string>;
} {
  let resolveFn: ((code: string) => void) | undefined;
  let rejectFn: ((err: unknown) => void) | undefined;
  const done = new Promise<string>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const registration = vscode.window.registerUriHandler({
    handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
      const params = new URLSearchParams(uri.query);
      const state = params.get('state');
      const code = params.get('code');
      const err = params.get('error');
      if (err) {
        rejectFn?.(new Error(`OAuth callback error: ${err}`));
        return;
      }
      if (state !== expectedState) {
        rejectFn?.(new Error('OAuth callback state mismatch.'));
        return;
      }
      if (!code) {
        rejectFn?.(new Error('OAuth callback missing code.'));
        return;
      }
      resolveFn?.(code);
    },
  });
  return {
    registration,
    waitForCode: () => withTimeout(done, 180000, 'OAuth callback timed out after 3 minutes.'),
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(v => {
      clearTimeout(timer);
      resolve(v);
    }, err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function generateSddForIssue(context: vscode.ExtensionContext, key: string): Promise<{
  issue: JiraIssue;
  output: SddProviderOutput;
  provider: Awaited<ReturnType<typeof resolveSddProvider>>;
  config: ReturnType<typeof getConfig>;
  baseBrowseUrl: string;
}> {
  const auth = await getAuth(context.secrets);
  if (!auth) {
    throw new Error('Authentication is not configured.');
  }
  const config = getConfig();
  const issue = await getIssue(config, key, auth);
  const tasks = extractTasks(issue);
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }
  const provider = await resolveSddProvider(config.sddProvider, root);
  const baseBrowseUrl = browseBaseUrl(config, auth);
  const output = provider.buildOutput(root, issue, tasks, baseBrowseUrl);
  return { issue, output, provider, config, baseBrowseUrl };
}

async function writeOutputFile(
  context: vscode.ExtensionContext,
  file: { relativePath: string; content: string },
  neverOverwrite: boolean,
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }
  const fullPath = path.join(root, file.relativePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  if (await exists(fullPath)) {
    if (neverOverwrite) {
      const answer = await vscode.window.showWarningMessage(
        `Jira Mini: file already exists: ${file.relativePath}. Overwrite?`,
        { modal: true },
        'Overwrite',
      );
      if (answer !== 'Overwrite') {
        throw new CancelledByUserError();
      }
    }
  }
  await fs.promises.writeFile(fullPath, file.content, 'utf-8');
  return fullPath;
}

async function ensureFileAndRead(
  context: vscode.ExtensionContext,
  file: { relativePath: string; content: string },
  neverOverwrite: boolean,
): Promise<string> {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new Error('No workspace folder open.');
  }
  const fullPath = path.join(root, file.relativePath);
  if (!(await exists(fullPath))) {
    await writeOutputFile(context, file, neverOverwrite);
    return file.content;
  }
  return fs.promises.readFile(fullPath, 'utf-8');
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function openFileInEditor(filePath: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function buildIssueSummaryForChat(config: JiraMiniConfig, issue: JiraIssue, browseBase: string): Promise<string> {
  const desc = adfToMarkdownText(issue.fields.description) || 'No description.';
  const subtasksText = (issue.fields.subtasks ?? [])
    .map(s => `- [${s.fields.status?.name ?? '?'}] ${s.key}: ${s.fields.summary ?? ''}`)
    .join('\n') || 'None';

  let specContent = '';
  let planContent = '';
  const root = getWorkspaceRoot();
  if (root) {
    const providerMode = config.sddProvider ?? 'auto';
    try {
      const provider = await resolveSddProvider(providerMode, root);
      const tasks = extractTasks(issue);
      const output = provider.buildOutput(root, issue, tasks, browseBase);
      const specPath = path.join(root, output.spec.relativePath);
      const planPath = path.join(root, output.plan.relativePath);
      if (fs.existsSync(specPath)) {
        specContent = fs.readFileSync(specPath, 'utf-8');
      }
      if (fs.existsSync(planPath)) {
        planContent = fs.readFileSync(planPath, 'utf-8');
      }
    } catch { /* ignore */ }
  }

  const lines: string[] = [
    `# Jira Issue: ${issue.key}`,
    `**Summary:** ${issue.fields.summary ?? ''}`,
    `**Status:** ${issue.fields.status?.name ?? ''}`,
    `**Type:** ${issue.fields.issuetype?.name ?? ''}`,
    `**Priority:** ${issue.fields.priority?.name ?? ''}`,
    `**Assignee:** ${issue.fields.assignee?.displayName ?? 'Unassigned'}`,
    `**Link:** ${browseBase}/browse/${issue.key}`,
    '',
    '## Description',
    desc,
    '',
    '## Subtasks',
    subtasksText,
  ];

  if (specContent) {
    lines.push('', '## SPEC (from SDD)', '```', specContent, '```');
  }
  if (planContent) {
    lines.push('', '## PLAN (from SDD)', '```', planContent, '```');
  }

  lines.push('', '---', 'Please implement/solve this issue following SDD if specs are present.');
  return lines.join('\n');
}

function normalizeBaseUrl(input: string): string | undefined {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return undefined;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') {
      return undefined;
    }
    if (!u.hostname.endsWith('.atlassian.net')) {
      return undefined;
    }
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return undefined;
  }
}

function randomUrlSafe(bytes: number): string {
  return base64Url(crypto.randomBytes(bytes));
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toErrorMessage(err: unknown): string {
  return `Jira Mini: ${err instanceof Error ? err.message : String(err)}`;
}

function isAgileFallbackStatus(msg: string): boolean {
  return msg.includes('status=400') || msg.includes('status=403') || msg.includes('status=404');
}

class CancelledByUserError extends Error {
  constructor() {
    super('cancelled by user');
  }
}

function isCancelledError(err: unknown): boolean {
  return err instanceof CancelledByUserError;
}

async function sendToCursorChat(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);

  const chatCommands = [
    'composerMode.agent',
    'aipanel.newchat',
    'workbench.action.chat.newChat',
    'workbench.action.chat.open',
  ];

  for (const cmd of chatCommands) {
    try {
      await vscode.commands.executeCommand(cmd);
      await new Promise(r => setTimeout(r, 300));
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      return;
    } catch {
      // command not available, try next
    }
  }

  vscode.window.showInformationMessage('Jira Mini: Copied to clipboard. Open chat with Cmd+L and paste.');
}
