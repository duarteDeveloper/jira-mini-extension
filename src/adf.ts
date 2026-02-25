import { AdfNode } from './types';

export function adfToMarkdownText(adf: AdfNode | null | undefined): string {
  if (!adf) { return ''; }
  return renderNode(adf).trim();
}

function renderNode(node: AdfNode, listIndent: number = 0): string {
  switch (node.type) {
    case 'doc':
      return renderChildren(node, '\n\n', listIndent);

    case 'paragraph':
      return renderInline(node) + '\n';

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      const prefix = '#'.repeat(level);
      return `${prefix} ${renderInline(node)}\n`;
    }

    case 'text':
      return renderTextWithMarks(node);

    case 'hardBreak':
      return '\n';

    case 'bulletList':
      return renderListItems(node, 'bullet', listIndent);

    case 'orderedList':
      return renderListItems(node, 'ordered', listIndent);

    case 'listItem':
      return renderChildren(node, '\n', listIndent);

    case 'taskList':
      return renderTaskItems(node, listIndent);

    case 'taskItem': {
      const done = node.attrs?.state === 'DONE';
      const check = done ? '[x]' : '[ ]';
      const indent = '  '.repeat(listIndent);
      const content = renderInline(node);
      return `${indent}- ${check} ${content}\n`;
    }

    case 'codeBlock': {
      const lang = (node.attrs?.language as string) || '';
      const code = extractText(node);
      return `\`\`\`${lang}\n${code}\n\`\`\`\n`;
    }

    case 'blockquote': {
      const inner = renderChildren(node, '\n', listIndent);
      return inner
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n') + '\n';
    }

    case 'panel': {
      const panelType = (node.attrs?.panelType as string) || 'info';
      const inner = renderChildren(node, '\n', listIndent);
      const lines = inner.split('\n').map(line => `> ${line}`).join('\n');
      return `> **[${panelType.toUpperCase()}]**\n${lines}\n`;
    }

    case 'rule':
      return '---\n';

    case 'mention': {
      const mentionText = (node.attrs?.text as string) || node.text || '';
      return mentionText.startsWith('@') ? mentionText : `@${mentionText}`;
    }

    case 'inlineCard': {
      const url = node.attrs?.url as string;
      return url ? `[${url}](${url})` : '';
    }

    case 'mediaGroup':
    case 'mediaSingle':
    case 'media':
      return '';

    case 'table':
      return renderTable(node);

    case 'tableRow':
    case 'tableHeader':
    case 'tableCell':
      return renderChildren(node, '', listIndent);

    case 'emoji': {
      const shortName = (node.attrs?.shortName as string) || '';
      return shortName || (node.attrs?.text as string) || '';
    }

    default:
      return extractText(node);
  }
}

function renderInline(node: AdfNode): string {
  if (!node.content) { return node.text || ''; }
  return node.content.map(child => renderNode(child)).join('');
}

function renderChildren(node: AdfNode, sep: string, listIndent: number): string {
  if (!node.content) { return ''; }
  return node.content.map(child => renderNode(child, listIndent)).join(sep);
}

function renderTextWithMarks(node: AdfNode): string {
  let text = node.text || '';
  if (!node.marks || node.marks.length === 0) { return text; }

  for (const mark of node.marks) {
    switch (mark.type) {
      case 'strong':
        text = `**${text}**`;
        break;
      case 'em':
        text = `*${text}*`;
        break;
      case 'code':
        text = `\`${text}\``;
        break;
      case 'strike':
        text = `~~${text}~~`;
        break;
      case 'link': {
        const href = mark.attrs?.href as string;
        if (href) { text = `[${text}](${href})`; }
        break;
      }
      case 'underline':
        text = `<u>${text}</u>`;
        break;
    }
  }
  return text;
}

function renderListItems(node: AdfNode, style: 'bullet' | 'ordered', listIndent: number): string {
  if (!node.content) { return ''; }
  const lines: string[] = [];
  const indent = '  '.repeat(listIndent);

  node.content.forEach((item, idx) => {
    const prefix = style === 'bullet' ? '-' : `${idx + 1}.`;

    if (!item.content) {
      lines.push(`${indent}${prefix} \n`);
      return;
    }

    const firstBlock = item.content[0];
    const firstLine = firstBlock ? renderInline(firstBlock).trim() : '';
    lines.push(`${indent}${prefix} ${firstLine}`);

    for (let i = 1; i < item.content.length; i++) {
      const child = item.content[i];
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        lines.push(renderNode(child, listIndent + 1));
      } else {
        lines.push(`${indent}  ${renderNode(child, listIndent).trim()}`);
      }
    }
  });

  return lines.join('\n') + '\n';
}

function renderTaskItems(node: AdfNode, listIndent: number): string {
  if (!node.content) { return ''; }
  return node.content.map(child => renderNode(child, listIndent)).join('');
}

function renderTable(node: AdfNode): string {
  if (!node.content) { return ''; }

  const rows: string[][] = [];
  let isFirstRow = true;
  let hasHeader = false;

  for (const row of node.content) {
    if (row.type !== 'tableRow' || !row.content) { continue; }

    const cells: string[] = [];
    for (const cell of row.content) {
      if (cell.type === 'tableHeader') { hasHeader = true; }
      cells.push(renderInline(cell).trim().replace(/\n/g, ' '));
    }
    rows.push(cells);

    if (isFirstRow && hasHeader) {
      rows.push(cells.map(() => '---'));
    }
    isFirstRow = false;
  }

  if (rows.length === 0) { return ''; }

  if (!hasHeader) {
    const colCount = rows[0].length;
    rows.splice(1, 0, Array(colCount).fill('---'));
  }

  return rows.map(r => `| ${r.join(' | ')} |`).join('\n') + '\n';
}

function extractText(node: AdfNode): string {
  if (node.text) { return node.text; }
  if (!node.content) { return ''; }
  return node.content.map(child => extractText(child)).join('');
}

// ---------------------------------------------------------------------------
// ADF -> HTML (safe, for WebviewPanel)
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function adfToHtml(adf: AdfNode | null | undefined): string {
  if (!adf) { return ''; }
  return htmlNode(adf);
}

function htmlNode(node: AdfNode): string {
  switch (node.type) {
    case 'doc':
      return htmlChildren(node);

    case 'paragraph':
      return `<p>${htmlInline(node)}</p>`;

    case 'heading': {
      const level = Math.min(Math.max((node.attrs?.level as number) || 1, 1), 6);
      return `<h${level}>${htmlInline(node)}</h${level}>`;
    }

    case 'text':
      return htmlTextWithMarks(node);

    case 'hardBreak':
      return '<br/>';

    case 'bulletList':
      return `<ul>${htmlChildren(node)}</ul>`;

    case 'orderedList':
      return `<ol>${htmlChildren(node)}</ol>`;

    case 'listItem':
      return `<li>${htmlChildren(node)}</li>`;

    case 'taskList':
      return `<ul>${htmlChildren(node)}</ul>`;

    case 'taskItem': {
      const done = node.attrs?.state === 'DONE';
      const check = done ? '&#9745;' : '&#9744;';
      return `<li>${check} ${htmlInline(node)}</li>`;
    }

    case 'codeBlock': {
      const code = escHtml(extractText(node));
      return `<pre><code>${code}</code></pre>`;
    }

    case 'blockquote':
      return `<blockquote>${htmlChildren(node)}</blockquote>`;

    case 'panel': {
      const panelType = escHtml((node.attrs?.panelType as string) || 'info');
      return `<blockquote><strong>[${panelType.toUpperCase()}]</strong>${htmlChildren(node)}</blockquote>`;
    }

    case 'rule':
      return '<hr/>';

    case 'mention': {
      const text = (node.attrs?.text as string) || node.text || '';
      const display = text.startsWith('@') ? text : `@${text}`;
      return `<span>${escHtml(display)}</span>`;
    }

    case 'inlineCard': {
      const url = node.attrs?.url as string;
      return url ? `<a href="${escHtml(url)}" target="_blank">${escHtml(url)}</a>` : '';
    }

    case 'mediaGroup':
    case 'mediaSingle':
    case 'media':
      return '';

    case 'table':
      return htmlTable(node);

    case 'tableRow':
      return `<tr>${htmlChildren(node)}</tr>`;

    case 'tableHeader':
      return `<th>${htmlChildren(node)}</th>`;

    case 'tableCell':
      return `<td>${htmlChildren(node)}</td>`;

    case 'emoji': {
      const shortName = (node.attrs?.shortName as string) || '';
      return escHtml(shortName || (node.attrs?.text as string) || '');
    }

    default:
      return escHtml(extractText(node));
  }
}

function htmlInline(node: AdfNode): string {
  if (!node.content) { return escHtml(node.text || ''); }
  return node.content.map(child => htmlNode(child)).join('');
}

function htmlChildren(node: AdfNode): string {
  if (!node.content) { return ''; }
  return node.content.map(child => htmlNode(child)).join('');
}

function htmlTextWithMarks(node: AdfNode): string {
  let text = escHtml(node.text || '');
  if (!node.marks || node.marks.length === 0) { return text; }

  for (const mark of node.marks) {
    switch (mark.type) {
      case 'strong':
        text = `<strong>${text}</strong>`;
        break;
      case 'em':
        text = `<em>${text}</em>`;
        break;
      case 'code':
        text = `<code>${text}</code>`;
        break;
      case 'strike':
        text = `<s>${text}</s>`;
        break;
      case 'link': {
        const href = mark.attrs?.href as string;
        if (href) { text = `<a href="${escHtml(href)}" target="_blank">${text}</a>`; }
        break;
      }
      case 'underline':
        text = `<u>${text}</u>`;
        break;
    }
  }
  return text;
}

function htmlTable(node: AdfNode): string {
  if (!node.content) { return ''; }
  return `<table>${node.content.map(child => htmlNode(child)).join('')}</table>`;
}
