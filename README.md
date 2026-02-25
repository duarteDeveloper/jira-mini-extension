# Jira Mini

Lightweight Jira Cloud integration built for AI-powered code editors like **Cursor** and **VS Code**. Browse boards, sprints, backlog, and epics without leaving your editor -- then send issues straight to the AI chat for resolution.

## Features

### Board & Sprint Tree View

Browse your Jira boards directly from the sidebar. Expand to see Backlog, Active Sprint, Future/Closed Sprints, and Epics with issue type badges (Epic, Story, Task, Sub-task, Bug).

### Issue Panel

Click any issue to open a rich detail panel inside the editor -- description (rendered from Atlassian Document Format), status, assignee, reporter, priority, story points, labels, components, fix versions, subtasks, and dates. No browser needed.

### Solve in Chat (AI Integration)

One-click sends issue context (description + specs + plans) to the Cursor AI chat. Batch-select multiple issues or use section-level "Solve All" to tackle a whole sprint at once.

### Status Transitions & Undo

Move issues through your workflow (e.g. To Do -> In Progress -> In Review) with dynamic transitions from the Jira API. Accidentally moved a card? An "Undo" button appears in a notification for quick rollback.

### Assign to Me / Inline Editing

Assign issues to yourself, unassign them, edit story points, and change priority directly from the issue panel sidebar.

### SDD (Spec Driven Development)

Three built-in providers that auto-detect your workspace structure:

| Provider | Detects | Output |
|----------|---------|--------|
| **Spec Kit** | `.specify/` folder | `specs/<key>/spec.md`, `plan.md`, `tasks.md` |
| **Agent OS** | `agent-os/` folder | `agent-os/specs/<ts>-<slug>/shape.md`, `plan.md`, `references.md` |
| **Generic** | fallback | `.sdd/<key>/SPEC.md`, `PLAN.md`, `TASKS.json` |

### Connect Wizard

Multi-step login supporting **API Token (Basic Auth)** and **OAuth 3LO (PKCE)** with automatic site selection.

### JQL Search

Robust search with a fallback chain across multiple Jira API versions. Quick commands for "All Open (Project)" and custom JQL queries.

### Project Scope Guard

Soft warning when you open an issue outside the current board's project scope, preventing accidental work on unrelated projects.

## Getting Started

1. Install the extension from the VS Code / Cursor marketplace.
2. Run **Jira Mini: Connect...** from the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
3. Choose **API Token (Basic Auth)** and enter your Jira site URL, email, and API token.
4. Run **Jira Mini: Pick Board** to select your active board.
5. Browse issues in the sidebar and click to open the detail panel.

> Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens

## Commands

| Command | Description |
|---------|-------------|
| `Jira Mini: Open` | Quick-pick menu with all main actions |
| `Jira Mini: Connect...` | Multi-step login wizard |
| `Jira Mini: Pick Board` | Select active board |
| `Jira Mini: Search (JQL)` | Custom JQL search |
| `Jira Mini: All Open (Project)` | List all open issues in project(s) |
| `Jira Mini: SDD (from Issue Key)` | Generate spec/plan from an issue |
| `Jira Mini: Assign to Me` | Assign an issue to yourself |
| `Jira Mini: Move Issue Status` | Transition issue status |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `jiraMini.baseUrl` | `""` | Jira Cloud base URL |
| `jiraMini.authMode` | `basic` | Authentication mode (`basic` or `oauth`) |
| `jiraMini.sdd.provider` | `auto` | SDD provider (`auto`, `spec-kit`, `agent-os`, `generic`) |
| `jiraMini.sdd.neverOverwrite` | `true` | Ask before overwriting existing SDD files |
| `jiraMini.maxResults` | `50` | Max issues per search |
| `jiraMini.cacheTtlSeconds` | `60` | Cache TTL in seconds |

## Development

### Prerequisites

- Node.js >= 18 (build with Node 22 via `nvm`)
- No external runtime dependencies

### Build

```bash
npm install
npm run compile
```

Press `F5` to launch the Extension Development Host.

### Watch mode

```bash
npm run watch
```

## License

[MIT](LICENSE)
