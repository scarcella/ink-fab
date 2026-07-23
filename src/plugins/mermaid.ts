import { WidgetType } from '@codemirror/view';
import mermaidLib from 'mermaid';
import type { InkFabPlugin } from './types';
import { blockShell } from './lib/block-shell';

// ```mermaid fences render as SVG diagrams. Render errors show inline
// instead of taking the editor down.

let mermaidIdCounter = 0;

// Mermaid bakes its palette into the rendered SVG, so the widget carries the
// theme it was rendered with: after a theme switch the editor reconfigures,
// eq() fails, and diagrams re-render in the new palette.
const APP_TO_MERMAID: Record<string, string> = {
  paper: 'neutral',
  light: 'default',
  dark: 'dark',
};

function activeMermaidTheme(override?: string) {
  if (override) return override;
  const appTheme = document.documentElement.dataset.theme ?? 'paper';
  return APP_TO_MERMAID[appTheme] ?? 'neutral';
}

class MermaidWidget extends WidgetType {
  constructor(readonly source: string, readonly theme: string) {
    super();
  }
  eq(other: MermaidWidget) {
    return other.source === this.source && other.theme === this.theme;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-mermaid-block';
    wrapper.textContent = this.source; // placeholder while rendering
    const id = `cm-mermaid-${++mermaidIdCounter}`;
    mermaidLib.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: this.theme as 'neutral',
      fontFamily: 'var(--font-sans)',
    });
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

// Follows the app theme by default; pass { theme } to pin a mermaid theme.
export function mermaid(opts: { theme?: string } = {}): InkFabPlugin {
  return {
    name: 'mermaid',
    fencedLangs: [
      {
        lang: 'mermaid',
        toWidget: (body) =>
          body.trim()
            ? new MermaidWidget(body.trim(), activeMermaidTheme(opts.theme))
            : null,
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
  color: var(--warm);
  background: color-mix(in srgb, var(--warm) 10%, transparent);
  padding: 10px 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  margin: 0;
}
`,
  };
}
