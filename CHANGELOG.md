# Changelog

All notable changes to the **Jira Mini** extension will be documented in this file.

## [0.1.0] - 2026-02-24

### Added

- **Connect Wizard** -- Multi-step login with API Token (Basic Auth) and OAuth 3LO (PKCE) support.
- **Board / Backlog / Sprint / Epic tree view** -- Browse Jira boards, backlog, active sprint, future/closed sprints, and epics directly in the sidebar.
- **Issue Panel (WebviewPanel)** -- Click any issue to open a rich detail panel inside the editor with description (ADF to HTML), status, assignee, reporter, priority, story points, labels, components, fix versions, subtasks, parent/epic link, and dates.
- **Solve in Chat** -- One-click sends issue context (description, specs, plans) to the Cursor AI chat.
- **Batch Solve** -- Multi-select issues or use section-level "Solve All" to send multiple issues to AI at once.
- **Status Transitions** -- "Move to..." button with dynamic transitions from the Jira API. Undo support via notification action.
- **Assign to Me / Unassign** -- Assign issues to yourself or unassign directly from the issue panel or tree context menu.
- **Inline Field Editing** -- Edit story points and priority from the issue panel sidebar.
- **SDD Providers** -- Spec Driven Development integration with three providers: Spec Kit, Agent OS, and Generic. Auto-detection based on workspace structure.
- **Project Scope Guard** -- Soft warning when opening issues outside the current board's project scope.
- **Issue Type Badges** -- Distinct icons and colors for Epics, Stories, Tasks, Sub-tasks, and Bugs in both tree view and issue panel.
- **JQL Search** -- Robust search with fallback chain (POST/GET across multiple API versions).
- **Status Bar** -- Quick access to board picker and SDD commands.
