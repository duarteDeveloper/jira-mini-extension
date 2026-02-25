import { SddProvider, JiraIssue, SddTask, SddProviderOutput } from '../../types';
import { generatePlan, generateSpec, generateTasksJson } from '../../sdd';

export class GenericProvider implements SddProvider {
  readonly id = 'generic';
  readonly label = 'Generic';

  async detect(): Promise<boolean> {
    return true;
  }

  buildOutput(
    _workspaceRoot: string,
    issue: JiraIssue,
    tasks: SddTask[],
    baseBrowseUrl: string,
  ): SddProviderOutput {
    const issueDir = `.sdd/${issue.key}`;
    return {
      spec: {
        relativePath: `${issueDir}/SPEC.md`,
        content: generateSpec(issue, baseBrowseUrl),
      },
      plan: {
        relativePath: `${issueDir}/PLAN.md`,
        content: generatePlan(issue, tasks, baseBrowseUrl),
      },
      extras: [{
        relativePath: `${issueDir}/TASKS.json`,
        content: generateTasksJson(tasks),
      }],
    };
  }

  buildPlanPrompt(issueKey: string, specContent: string, planContent: string, baseBrowseUrl: string): string {
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
- **Key**: ${issueKey}
- **Link**: ${baseBrowseUrl}/browse/${issueKey}

## SPEC.md
\`\`\`markdown
${truncate(specContent)}
\`\`\`

## PLAN.md
\`\`\`markdown
${truncate(planContent)}
\`\`\`

## Instruções
1. Leia e entenda o SPEC completamente.
2. Valide requisitos e liste premissas / riscos.
3. Produza plano de implementação incremental com checkpoints.
4. Produza checklist de PRs/commits e testes.
5. Implemente tarefa por tarefa, marcando DONE no PLAN.md.
`;
  }
}

function truncate(input: string): string {
  const maxLen = 8000;
  if (input.length <= maxLen) {
    return input;
  }
  return `${input.slice(0, maxLen)}\n\n... (truncated, see full file)`;
}
