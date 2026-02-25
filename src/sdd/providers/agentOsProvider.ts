import * as fs from 'fs/promises';
import * as path from 'path';
import { JiraIssue, SddProvider, SddProviderOutput, SddTask } from '../../types';
import { adfToMarkdownText } from '../../adf';

export class AgentOsProvider implements SddProvider {
  readonly id = 'agent-os';
  readonly label = 'Agent OS';

  async detect(workspaceRoot: string): Promise<boolean> {
    try {
      const st = await fs.stat(path.join(workspaceRoot, 'agent-os'));
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
    const ts = nowTimestamp();
    const base = `agent-os/specs/${ts}-${slug}`;
    return {
      spec: {
        relativePath: `${base}/shape.md`,
        content: buildShape(issue, baseBrowseUrl),
      },
      plan: {
        relativePath: `${base}/plan.md`,
        content: buildPlan(issue, tasks),
      },
      extras: [
        {
          relativePath: `${base}/references.md`,
          content: buildReferences(issue, baseBrowseUrl),
        },
      ],
    };
  }

  buildPlanPrompt(issueKey: string, specContent: string, planContent: string, baseBrowseUrl: string): string {
    return `Use Agent OS spec workflow for ${issueKey}.
Reference: ${baseBrowseUrl}/browse/${issueKey}

shape.md:
${specContent}

plan.md:
${planContent}
`;
  }
}

function buildShape(issue: JiraIssue, baseBrowseUrl: string): string {
  return `# Shape\n\nIssue: ${issue.key}\nSummary: ${issue.fields.summary}\nLink: ${baseBrowseUrl}/browse/${issue.key}\n\n## Problem\n${adfToMarkdownText(issue.fields.description) || '_No description provided._'}\n`;
}

function buildPlan(issue: JiraIssue, tasks: SddTask[]): string {
  const list = tasks.map((t, i) => `- [ ] ${i + 1}. ${t.summary}`).join('\n') || '- [ ] Define implementation tasks';
  return `# Plan\n\n## Outcome\nDeliver ${issue.key} - ${issue.fields.summary}\n\n## Task List\n${list}\n`;
}

function buildReferences(issue: JiraIssue, baseBrowseUrl: string): string {
  return `# References\n\n- Jira issue: ${baseBrowseUrl}/browse/${issue.key}\n- Project: ${issue.fields.project?.key || 'N/A'}\n- Labels: ${(issue.fields.labels || []).join(', ') || 'None'}\n`;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'issue';
}

function nowTimestamp(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const sec = String(now.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}
