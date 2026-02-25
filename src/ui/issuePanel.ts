import * as vscode from 'vscode';

export interface IssuePayload {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  assignee: string;
  reporter: string;
  priority: string;
  issueType: string;
  labels: string[];
  descriptionHtml: string;
  subtasks: { key: string; summary: string; status: string }[];
  projectKey: string;
  projectName: string;
  parentKey: string;
  parentSummary: string;
  storyPoints: number | null;
  created: string;
  updated: string;
  resolution: string;
  components: string[];
  fixVersions: string[];
}

export class IssuePanel {
  private static current?: IssuePanel;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => {
      if (IssuePanel.current === this) {
        IssuePanel.current = undefined;
      }
    });
  }

  static show(context: vscode.ExtensionContext): IssuePanel {
    const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;
    if (IssuePanel.current) {
      IssuePanel.current.panel.reveal(col, true);
      return IssuePanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'jiraMini.issuePanel',
      'Jira Issue',
      col,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    IssuePanel.current = new IssuePanel(panel);
    context.subscriptions.push(panel);
    return IssuePanel.current;
  }

  setTitle(title: string): void {
    this.panel.title = title;
  }

  render(issue: IssuePayload): void {
    this.panel.webview.html = buildHtml(issue);
  }

  onMessage(handler: (msg: { type: string; key?: string; value?: string }) => void): vscode.Disposable {
    return this.panel.webview.onDidReceiveMessage(handler);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function issueTypeClass(name: string): string {
  switch (name.toLowerCase()) {
    case 'epic': return 'chip-epic';
    case 'story': return 'chip-story';
    case 'task': return 'chip-task';
    case 'sub-task':
    case 'subtask': return 'chip-subtask';
    case 'bug': return 'chip-bug';
    default: return '';
  }
}

function statusClass(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved') {
    return 'status-done';
  }
  if (lower.includes('progress') || lower === 'in review' || lower === 'review') {
    return 'status-progress';
  }
  return 'status-todo';
}

function accentColor(issueType: string): string {
  switch (issueType.toLowerCase()) {
    case 'epic': return '#7C3AED';
    case 'story': return '#2563EB';
    case 'task': return '#059669';
    case 'sub-task':
    case 'subtask': return '#6B7280';
    case 'bug': return '#DC2626';
    default: return '#6B7280';
  }
}

function chip(text: string, extraClass?: string): string {
  if (!text) { return ''; }
  const cls = extraClass ? `chip ${extraClass}` : 'chip';
  return `<span class="${cls}">${esc(text)}</span>`;
}

function statusDot(status: string): string {
  return `<span class="dot ${statusClass(status)}" title="${esc(status)}"></span>`;
}

function formatDate(iso: string): string {
  if (!iso) { return '—'; }
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function detailRow(label: string, value: string, extra?: string, actionsHtml?: string): string {
  const valHtml = (!value || value === '—')
    ? '<span class="detail-value muted">—</span>'
    : `<span class="detail-value">${extra ?? esc(value)}</span>`;
  const actions = actionsHtml ? `<div class="detail-actions">${actionsHtml}</div>` : '';
  return `<div class="detail-row"><span class="detail-label">${esc(label)}</span>${valHtml}${actions}</div>`;
}

function buildHtml(i: IssuePayload): string {
  const accent = accentColor(i.issueType);

  const typeChip = chip(i.issueType, issueTypeClass(i.issueType));
  const statusChip = chip(i.status, statusClass(i.status));

  const labels = i.labels.length
    ? `<div class="section">
        <div class="section-title">Labels</div>
        <div class="chips">${i.labels.map(l => chip(l)).join(' ')}</div>
      </div>`
    : '';

  const components = i.components.length
    ? `<div class="section">
        <div class="section-title">Components</div>
        <div class="chips">${i.components.map(c => chip(c)).join(' ')}</div>
      </div>`
    : '';

  const fixVersions = i.fixVersions.length
    ? `<div class="section">
        <div class="section-title">Fix Versions</div>
        <div class="chips">${i.fixVersions.map(v => chip(v)).join(' ')}</div>
      </div>`
    : '';

  const parentHtml = i.parentKey
    ? `<div class="detail-row">
        <span class="detail-label">Parent / Epic</span>
        <span class="detail-value">
          <a href="#" onclick="post('openIssue','${esc(i.parentKey)}');return false;">${esc(i.parentKey)}</a>
          <span class="muted" style="margin-left:4px">${esc(i.parentSummary)}</span>
        </span>
      </div>`
    : '';

  const subtasks = i.subtasks.length
    ? i.subtasks.map(s =>
      `<div class="subtask-row">
        <div class="subtask-left">
          ${statusDot(s.status)}
          <span class="subtask-key" onclick="post('openIssue','${esc(s.key)}')">${esc(s.key)}</span>
          <span class="subtask-sum">${esc(s.summary)}</span>
        </div>
        <div class="subtask-right">
          ${chip(s.status, statusClass(s.status))}
        </div>
      </div>`).join('')
    : '<div class="empty">No subtasks</div>';

  const spHtml = i.storyPoints !== null && i.storyPoints !== undefined
    ? `<span class="sp-badge" title="Story Points">${i.storyPoints}</span>`
    : '';

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  :root {
    --fg: var(--vscode-editor-foreground, #ccc);
    --fg2: var(--vscode-descriptionForeground, rgba(200,200,200,.7));
    --bg: var(--vscode-editor-background, #1e1e1e);
    --border: var(--vscode-panel-border, rgba(128,128,128,.2));
    --chip-bg: var(--vscode-badge-background, rgba(128,128,128,.15));
    --chip-fg: var(--vscode-badge-foreground, inherit);
    --btn-bg: var(--vscode-button-secondaryBackground, rgba(128,128,128,.12));
    --btn-hover: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.22));
    --btn-primary: var(--vscode-button-background, #0e639c);
    --btn-primary-fg: var(--vscode-button-foreground, #fff);
    --link: var(--vscode-textLink-foreground, #3794ff);
    --card-bg: var(--vscode-editorWidget-background, rgba(128,128,128,.05));
    --sidebar-bg: var(--vscode-sideBar-background, rgba(128,128,128,.04));
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--fg);
    background: var(--bg);
    line-height: 1.5;
  }

  .accent-bar { height: 4px; background: ${accent}; }
  .layout { display: flex; min-height: calc(100vh - 4px); }

  .main { flex: 1; min-width: 0; padding: 20px 24px; overflow-y: auto; }
  .sidebar { width: 320px; min-width: 240px; flex-shrink: 1; border-left: 1px solid var(--border); background: var(--sidebar-bg); padding: 16px; overflow-y: auto; }
  @media (max-width: 700px) {
    .layout { flex-direction: column; }
    .sidebar { width: 100%; min-width: unset; border-left: none; border-top: 1px solid var(--border); }
  }

  .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .header-left { flex: 1; min-width: 0; }
  .issue-key-row { display: flex; align-items: center; gap: 8px; }
  .issue-key { font-size: 12px; font-weight: 700; opacity: .6; letter-spacing: .3px; text-transform: uppercase; }
  .issue-summary { font-size: 1.4em; font-weight: 600; line-height: 1.3; margin: 6px 0 10px; }
  .chips { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
  .chip {
    font-size: 11px; padding: 2px 10px; border-radius: 99px;
    background: var(--chip-bg); color: var(--chip-fg);
    white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;
  }
  .chip-epic { background: #7C3AED; color: #fff; }
  .chip-story { background: #2563EB; color: #fff; }
  .chip-task { background: #059669; color: #fff; }
  .chip-bug { background: #DC2626; color: #fff; }
  .chip-subtask { background: #6B7280; color: #fff; }
  .status-done { background: #059669; color: #fff; }
  .status-progress { background: #2563EB; color: #fff; }
  .status-todo { background: var(--chip-bg); color: var(--chip-fg); }

  .sp-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; border-radius: 50%;
    background: ${accent}; color: #fff;
    font-size: 11px; font-weight: 700;
  }

  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .btn {
    border: none; border-radius: 6px; padding: 7px 14px; cursor: pointer;
    font-size: 12px; font-family: inherit; font-weight: 500;
    background: var(--btn-bg); color: var(--fg);
    transition: background .15s;
  }
  .btn:hover { background: var(--btn-hover); }
  .btn-primary { background: var(--btn-primary); color: var(--btn-primary-fg); }
  .btn-primary:hover { opacity: .85; }
  .btn-accent { background: ${accent}; color: #fff; }
  .btn-accent:hover { opacity: .85; }

  .divider { height: 1px; background: var(--border); margin: 20px 0; }

  .section { margin-top: 20px; }
  .section-title {
    font-weight: 600; margin-bottom: 8px; opacity: .8;
    text-transform: uppercase; letter-spacing: .4px; font-size: 11px;
  }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
  }

  .desc { line-height: 1.6; word-wrap: break-word; overflow-wrap: break-word; }
  .desc h1, .desc h2, .desc h3, .desc h4 { margin: 14px 0 6px; }
  .desc p { margin: 8px 0; }
  .desc ul, .desc ol { margin: 8px 0 8px 20px; }
  .desc li { margin: 2px 0; }
  .desc pre { background: rgba(128,128,128,.1); padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  .desc code { background: rgba(128,128,128,.14); padding: 1px 5px; border-radius: 4px; font-size: .92em; }
  .desc pre code { background: none; padding: 0; }
  .desc blockquote { border-left: 3px solid var(--border); margin: 8px 0; padding: 4px 12px; opacity: .85; }
  .desc table { border-collapse: collapse; margin: 8px 0; }
  .desc th, .desc td { border: 1px solid var(--border); padding: 5px 10px; text-align: left; }
  .desc th { font-weight: 600; }

  .subtask-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; border-bottom: 1px solid var(--border); gap: 8px;
  }
  .subtask-row:last-child { border-bottom: none; }
  .subtask-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  .subtask-right { flex-shrink: 0; }
  .subtask-key { font-weight: 600; white-space: nowrap; cursor: pointer; color: var(--link); font-size: 12px; }
  .subtask-key:hover { text-decoration: underline; }
  .subtask-sum { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .dot.status-done { background: #059669; }
  .dot.status-progress { background: #2563EB; }
  .dot.status-todo { background: #6B7280; }

  .detail-row { display: flex; flex-direction: column; padding: 7px 0; border-bottom: 1px solid var(--border); gap: 2px; }
  .detail-row:last-child { border-bottom: none; }
  .detail-label { font-size: 11px; text-transform: uppercase; letter-spacing: .3px; opacity: .55; }
  .detail-value { font-size: 13px; word-break: break-word; }

  .sidebar-section { margin-bottom: 16px; }
  .sidebar-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; opacity: .5; margin-bottom: 8px; }

  .empty { font-style: italic; opacity: .45; padding: 4px 0; }
  .muted { opacity: .55; }
  a { color: var(--link); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .action-link {
    font-size: 11px; color: var(--link); cursor: pointer;
    opacity: .7; transition: opacity .15s;
  }
  .action-link:hover { opacity: 1; text-decoration: underline; }
  .detail-actions { display: flex; gap: 8px; margin-top: 2px; }
</style>
</head><body>

<div class="accent-bar"></div>
<div class="layout">

  <div class="main">
    <div class="header">
      <div class="header-left">
        <div class="issue-key-row">
          <span class="issue-key">${esc(i.key)}</span>
          ${typeChip}
          ${statusChip}
          ${spHtml}
        </div>
        <div class="issue-summary">${esc(i.summary)}</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn" onclick="post('openInJira','${esc(i.key)}')">Open in Jira</button>
      <button class="btn" onclick="post('transition','${esc(i.key)}')">Move to...</button>
      <button class="btn btn-accent" onclick="post('sdd','${esc(i.key)}')">SDD</button>
      <button class="btn btn-primary" onclick="post('solveInChat','${esc(i.key)}')">Solve in Chat</button>
    </div>

    <div class="divider"></div>

    <div class="section">
      <div class="section-title">Description</div>
      <div class="card desc">${i.descriptionHtml || '<div class="empty">No description</div>'}</div>
    </div>

    ${labels}
    ${components}
    ${fixVersions}

    <div class="section">
      <div class="section-title">Subtasks (${i.subtasks.length})</div>
      <div class="card">${subtasks}</div>
    </div>
  </div>

  <div class="sidebar">
    <div class="sidebar-section">
      <div class="sidebar-title">Details</div>
      ${detailRow('Status', i.status, chip(i.status, statusClass(i.status)))}
      ${detailRow('Type', i.issueType, chip(i.issueType, issueTypeClass(i.issueType)))}
      ${detailRow('Priority', i.priority, undefined,
        `<span class="action-link" onclick="post('editPriority','${esc(i.key)}')">Change</span>`)}
      ${detailRow('Resolution', i.resolution || '—')}
      ${detailRow('Story Points',
        i.storyPoints !== null && i.storyPoints !== undefined ? String(i.storyPoints) : '—',
        undefined,
        `<span class="action-link" onclick="post('editStoryPoints','${esc(i.key)}')">Edit</span>`)}
    </div>

    <div class="sidebar-section">
      <div class="sidebar-title">People</div>
      ${detailRow('Assignee', i.assignee || 'Unassigned', undefined,
        `<span class="action-link" onclick="post('assignToMe','${esc(i.key)}')">Assign to Me</span>`
        + (i.assignee && i.assignee !== 'Unassigned'
          ? ` <span class="action-link" onclick="post('unassign','${esc(i.key)}')">Unassign</span>`
          : ''))}
      ${detailRow('Reporter', i.reporter || '—')}
    </div>

    <div class="sidebar-section">
      <div class="sidebar-title">Context</div>
      ${detailRow('Project', i.projectKey ? `${i.projectKey} — ${i.projectName}` : '—')}
      ${parentHtml}
    </div>

    <div class="sidebar-section">
      <div class="sidebar-title">Dates</div>
      ${detailRow('Created', formatDate(i.created))}
      ${detailRow('Updated', formatDate(i.updated))}
    </div>
  </div>

</div>

<script>
  var vscode = acquireVsCodeApi();
  function post(type, key) { vscode.postMessage({type: type, key: key}); }
</script>
</body></html>`;
}
