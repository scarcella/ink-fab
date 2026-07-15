import { WidgetType } from '@codemirror/view';
import hljs from 'highlight.js';
import type { InkFabPlugin } from './types';
import { blockShell } from './lib/block-shell';

// Fenced code in any language highlight.js knows renders as a highlighted
// card when the caret is outside the fence.

class HighlightedCodeWidget extends WidgetType {
  constructor(readonly source: string, readonly lang: string) {
    super();
  }
  eq(other: HighlightedCodeWidget) {
    return other.source === this.source && other.lang === this.lang;
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-code-block';
    const label = document.createElement('div');
    label.className = 'cm-code-lang';
    label.textContent = this.lang;
    wrapper.appendChild(label);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = `hljs language-${this.lang}`;
    try {
      const { value } = hljs.getLanguage(this.lang)
        ? hljs.highlight(this.source, { language: this.lang, ignoreIllegals: true })
        : hljs.highlightAuto(this.source);
      code.innerHTML = value;
    } catch {
      code.textContent = this.source;
    }
    pre.appendChild(code);
    wrapper.appendChild(pre);
    return blockShell(wrapper);
  }
  ignoreEvent() {
    return false;
  }
}

export function highlight(): InkFabPlugin {
  return {
    name: 'highlight',
    fencedLangs: [
      {
        // Predicate, not a list: highlight.js resolves aliases (js, ts, py…)
        // dynamically, so enumerating languages up front would miss them.
        lang: (lang) => lang !== '' && Boolean(hljs.getLanguage(lang)),
        toWidget: (body, lang) =>
          body.length > 0 ? new HighlightedCodeWidget(body, lang) : null,
      },
    ],
    styles: `
.cm-code-block {
  margin: 0;
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  background: var(--bg-sunken);
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
}
.cm-code-block .cm-code-lang {
  font-family: var(--font-sans);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--fg-muted);
  padding: 6px 14px;
  border-bottom: 1px solid var(--border-soft);
  background: rgba(0, 0, 0, 0.02);
}
.cm-code-block pre {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
}
.cm-code-block code.hljs {
  background: transparent;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
}
`,
  };
}
