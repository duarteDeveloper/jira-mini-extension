import * as fs from 'fs/promises';
import * as path from 'path';
import { JiraIssue, SddProvider, SddProviderOutput, SddTask } from '../../types';
import { adfToMarkdownText } from '../../adf';

export class SpecKitProvider implements SddProvider {
  readonly id = 'spec-kit';
  readonly label = 'Spec Kit';

  async detect(workspaceRoot: string): Promise<boolean> {
    try {
      const st = await fs.stat(path.join(workspaceRoot, '.specify'));
      return st.isDirectory();
    } catch {
      return false;
    }
  }

  buildOutput(
    _workspaceRoot: string,
    issue: JiraIssue,
    tasks: SddTask[],
    baseBrowseUrl: string,
  ): SddProviderOutput {
    const slug = slugify(issue.fields.summary);
    const base = `specs/${issue.key}-${slug}`;
    return {
      spec: {
        relativePath: `${base}/spec.md`,
        content: buildSpec(issue, baseBrowseUrl),
      },
      plan: {
        relativePath: `${base}/plan.md`,
        content: buildPlan(issue, tasks),
      },
      extras: [
        {
          relativePath: `${base}/tasks.md`,
          content: buildTasks(tasks),
        },
      ],
    };
  }

  buildPlanPrompt(issueKey: string, specContent: string, planContent: string, baseBrowseUrl: string): string {
    return `Follow Spec Kit workflow for issue ${issueKey}.
Reference: ${baseBrowseUrl}/browse/${issueKey}

Use spec.md as the source of truth, then execute/adjust plan.md.

spec.md:
${specContent}

plan.md:
${planContent}
`;
  }
}

function buildSpec(issue: JiraIssue, baseBrowseUrl: string): string {
  return `# Spec\n\n## Issue\n- Key: ${issue.key}\n- Link: ${baseBrowseUrl}/browse/${issue.key}\n- Summary: ${issue.fields.summary}\n\n## Description\n${adfToMarkdownText(issue.fields.description) || '_No description provided._'}\n`;
}

function buildPlan(issue: JiraIssue, tasks: SddTask[]): string {
  const rows = tasks.map((t, i) => `${i + 1}. ${t.summary}`).join('\n') || '1. Define implementation tasks';
  return `# Plan\n\n## Goal\nImplement ${issue.key} - ${issue.fields.summary}\n\n## Steps\n${rows}\n`;
}

function buildTasks(tasks: SddTask[]): string {
  if (tasks.length === 0) {
    return '# Tasks\n\n- [ ] Add tasks manually from Jira details.\n';
  }
  return `# Tasks\n\n${tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.summary}`).join('\n')}\n`;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'issue';
}
