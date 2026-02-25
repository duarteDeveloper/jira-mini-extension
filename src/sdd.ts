import { JiraIssue, SddTask, AdfNode } from './types';
import { adfToMarkdownText } from './adf';

export function generateSpec(issue: JiraIssue, baseUrl: string): string {
  const f = issue.fields;
  const lines: string[] = [
    `# SPEC: ${issue.key} — ${f.summary}`,
    '',
    `- **Project**: ${f.project?.name || 'N/A'}`,
    `- **Type**: ${f.issuetype?.name || 'N/A'}`,
    `- **Priority**: ${f.priority?.name || 'N/A'}`,
    `- **Status**: ${f.status?.name || 'N/A'}`,
    `- **Assignee**: ${f.assignee?.displayName || 'Unassigned'}`,
    `- **Reporter**: ${f.reporter?.displayName || 'N/A'}`,
    `- **Labels**: ${f.labels && f.labels.length > 0 ? f.labels.join(', ') : 'None'}`,
  ];

  if (f.parent) {
    lines.push(`- **Parent**: ${f.parent.key}${f.parent.fields?.summary ? ' — ' + f.parent.fields.summary : ''}`);
  }

  lines.push(`- **Link**: ${baseUrl}/browse/${issue.key}`);
  lines.push('');
  lines.push('## Description');
  lines.push('');

  const desc = adfToMarkdownText(f.description);
  lines.push(desc || '_No description provided._');

  return lines.join('\n') + '\n';
}

export function extractTasks(issue: JiraIssue): SddTask[] {
  const tasks: SddTask[] = [];
  const seen = new Set<string>();

  function addUnique(task: SddTask): void {
    const norm = task.summary.toLowerCase().trim();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      tasks.push(task);
    }
  }

  if (issue.fields.subtasks) {
    for (const sub of issue.fields.subtasks) {
      addUnique({
        id: sub.key,
        summary: sub.fields.summary,
        source: 'subtask',
        done: sub.fields.status?.statusCategory?.key === 'done',
      });
    }
  }

  if (issue.fields.description) {
    extractTaskItemsFromAdf(issue.fields.description, tasks.length, addUnique);
  }

  const markdown = adfToMarkdownText(issue.fields.description);
  extractTasksFromMarkdown(markdown, tasks.length, addUnique);

  return tasks;
}

function extractTaskItemsFromAdf(
  node: AdfNode,
  startIdx: number,
  addUnique: (t: SddTask) => void,
): void {
  if (node.type === 'taskItem') {
    const text = extractTextFromAdf(node).trim();
    if (text) {
      addUnique({
        id: `task-${startIdx + 1}`,
        summary: text,
        source: 'taskItem',
        done: node.attrs?.state === 'DONE',
      });
    }
  }

  if (node.content) {
    for (const child of node.content) {
      extractTaskItemsFromAdf(child, startIdx, addUnique);
    }
  }
}

function extractTextFromAdf(node: AdfNode): string {
  if (node.text) { return node.text; }
  if (!node.content) { return ''; }
  return node.content.map(c => extractTextFromAdf(c)).join('');
}

function extractTasksFromMarkdown(
  markdown: string,
  startIdx: number,
  addUnique: (t: SddTask) => void,
): void {
  const lines = markdown.split('\n');
  let counter = startIdx;
  let inTaskSection = false;

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)/);
    if (headingMatch) {
      inTaskSection = /tasks|to.?do|implementation/i.test(headingMatch[1]);
      continue;
    }

    const checkboxMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      counter++;
      addUnique({
        id: `md-${counter}`,
        summary: checkboxMatch[2].trim(),
        source: 'heuristic',
        done: checkboxMatch[1].toLowerCase() === 'x',
      });
      continue;
    }

    if (inTaskSection) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
      if (bulletMatch) {
        counter++;
        addUnique({
          id: `md-${counter}`,
          summary: bulletMatch[1].trim(),
          source: 'heuristic',
          done: false,
        });
      }
    }
  }
}

export function generatePlan(issue: JiraIssue, tasks: SddTask[], baseUrl: string): string {
  const f = issue.fields;
  const lines: string[] = [
    `# PLAN: ${issue.key} — ${f.summary}`,
    '',
    `> Source: ${baseUrl}/browse/${issue.key}`,
    '',
    '## Tasks',
    '',
  ];

  if (tasks.length > 0) {
    lines.push('| # | Task | Source | Done |');
    lines.push('|---|------|--------|------|');
    tasks.forEach((t, i) => {
      const check = t.done ? '[x]' : '[ ]';
      lines.push(`| ${i + 1} | ${t.summary} | ${t.source} | ${check} |`);
    });
  } else {
    lines.push('_No tasks extracted. Add tasks manually or update the Jira issue._');
  }

  lines.push('');
  lines.push('## Execution Checkpoints');
  lines.push('');
  lines.push('_(To be filled by the agent during implementation)_');
  lines.push('');
  lines.push('## Test Checklist');
  lines.push('');
  lines.push('_(To be filled by the agent during implementation)_');

  return lines.join('\n') + '\n';
}

export function generateTasksJson(tasks: SddTask[]): string {
  return JSON.stringify(tasks, null, 2) + '\n';
}

export function buildCursorPrompt(
  key: string,
  baseUrl: string,
  specContent: string,
  planContent: string,
): string {
  const maxLen = 8000;
  const spec = specContent.length > maxLen
    ? specContent.slice(0, maxLen) + '\n\n... (truncated, see full SPEC.md)'
    : specContent;
  const plan = planContent.length > maxLen
    ? planContent.slice(0, maxLen) + '\n\n... (truncated, see full PLAN.md)'
    : planContent;

  return `Você é um agente de implementação. Siga SDD (Spec Driven Development):

## Regras SDD
- Use o SPEC abaixo como fonte de verdade.
- Antes de codar, confirme premissas e liste riscos.
- Quebre em tarefas atômicas com checkpoints.
- Produza plano de execução incremental (1 PR por etapa).
- Gere lista de testes.
- Somente depois, comece a implementar.
- Quando uma tarefa terminar, marque como DONE no PLAN.md.
- Se precisar mudar o spec, atualize SPEC.md primeiro.

## Issue
- **Key**: ${key}
- **Link**: ${baseUrl}/browse/${key}

## SPEC.md
\`\`\`markdown
${spec}
\`\`\`

## PLAN.md
\`\`\`markdown
${plan}
\`\`\`

## Instruções
1. Leia e entenda o SPEC completamente.
2. Valide requisitos e liste premissas / riscos.
3. Produza plano de implementação incremental com checkpoints.
4. Produza checklist de PRs/commits e testes.
5. Implemente tarefa por tarefa, marcando DONE no PLAN.md.
`;
}
