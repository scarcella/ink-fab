import { WidgetType } from '@codemirror/view';
import mermaidLib from 'mermaid';
import type { InkFabPlugin } from './types';
import { blockShell } from './lib/block-shell';

// ```mermaid fences render as SVG diagrams. Render errors show inline
// instead of taking the editor down.

let mermaidIdCounter = 0;

class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-mermaid-block';
    wrapper.textContent = this.source; // placeholder while rendering
    const id = `cm-mermaid-${++mermaidIdCounter}`;
    mermaidLib
      .render(id, this.source)
      .then(({ svg, bindFunctions }) => {
        wrapper.innerHTML = svg;
        bindFunctions?.(wrapper);
      })
      .catch((err) => {
        wrapper.textContent = '';
        const pre = document.createElement('pre');
        pre.className = 'cm-mermaid-error';
        pre.textContent = `Mermaid error: ${err?.message ?? err}\n\n${this.source}`;
        wrapper.appendChild(pre);
      });
    return blockShell(wrapper);
  }
  ignoreEvent() {
    return false;
  }
}

export function mermaid(opts: { theme?: string } = {}): InkFabPlugin {
  mermaidLib.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: (opts.theme ?? 'neutral') as 'neutral',
    fontFamily: 'var(--font-sans)',
  });

  return {
    name: 'mermaid',
    fencedLangs: [
      {
        lang: 'mermaid',
        toWidget: (body) => (body.trim() ? new MermaidWidget(body.trim()) : null),
      },
    ],
    styles: `
.cm-mermaid-block {
  margin: 0;
  padding: 1.2em;
  display: flex;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  overflow-x: auto;
}
.cm-mermaid-block svg {
  max-width: 100%;
  height: auto;
}
.cm-mermaid-error {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #9a3412;
  background: rgba(154, 52, 18, 0.08);
  padding: 10px 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  margin: 0;
}
`,
  };
}
