import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  markdown,
  markdownLanguage,
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
} from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { GFM } from '@lezer/markdown';
import { createLiveMarkdown } from './liveMarkdown';

const MARKDOWN_FILE_RE = /\.(md|markdown|mdown|txt)$/i;

const mdHighlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--fg-muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: '#92400e' },
  { tag: t.quote, color: 'var(--fg-muted)' },
  { tag: t.list, color: 'var(--fg-muted)' },
  { tag: t.processingInstruction, color: 'var(--fg-muted)' },
  { tag: t.contentSeparator, color: 'var(--border)' },
  { tag: t.heading1, fontWeight: '700' },
  { tag: t.heading2, fontWeight: '700' },
  { tag: t.heading3, fontWeight: '700' },
  { tag: t.heading4, fontWeight: '700' },
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-serif)',
    fontSize: '18px',
    lineHeight: '1.75',
    color: 'var(--fg)',
  },
  '.cm-content': {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '80px 72px 280px 72px',
    caretColor: 'var(--fg)',
    fontVariantLigatures: 'common-ligatures',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(12,74,110,0.12) !important',
  },
  '.cm-cursor': {
    borderLeftWidth: '2px',
    borderLeftColor: 'var(--accent)',
  },
});

type Props = {
  value: string;
  filePath: string | null;
  onChange: (v: string) => void;
  onOpenFile: (filePath: string) => void | Promise<void>;
};

export default function Editor({ value, filePath, onChange, onOpenFile }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveMarkdownCompartmentRef = useRef<Compartment | null>(null);
  const isSyncingExternalValueRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const liveMarkdownCompartment = new Compartment();
    liveMarkdownCompartmentRef.current = liveMarkdownCompartment;
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([
          { key: 'Enter', run: insertNewlineContinueMarkup },
          { key: 'Backspace', run: deleteMarkupBackward },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        markdown({ base: markdownLanguage, addKeymap: true, extensions: [GFM] }),
        syntaxHighlighting(mdHighlight),
        liveMarkdownCompartment.of(createLiveMarkdown(filePath)),
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !isSyncingExternalValueRef.current) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      liveMarkdownCompartmentRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    const liveMarkdownCompartment = liveMarkdownCompartmentRef.current;
    if (!view || !liveMarkdownCompartment) return;
    view.dispatch({
      effects: liveMarkdownCompartment.reconfigure(createLiveMarkdown(filePath)),
    });
  }, [filePath]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      isSyncingExternalValueRef.current = true;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: 0 },
      });
      isSyncingExternalValueRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return;

      const tocTarget = event.target.closest<HTMLElement>('[data-inkfab-toc]');
      if (tocTarget) {
        const id = tocTarget.dataset.inkfabToc;
        if (id) {
          event.preventDefault();
          const heading = view.dom.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
          heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      const target = event.target.closest<HTMLElement>('[data-inkfab-href]');
      if (!target) return;

      const href = target.dataset.inkfabHref;
      if (!href) return;

      event.preventDefault();

      const localPath = target.dataset.inkfabPath;
      if (localPath) {
        if (MARKDOWN_FILE_RE.test(localPath)) {
          void onOpenFile(localPath);
        } else {
          void window.inkfab.openPath(localPath);
        }
        return;
      }

      void window.inkfab.openExternal(href);
    };

    view.dom.addEventListener('click', onClick);
    return () => {
      view.dom.removeEventListener('click', onClick);
    };
  }, [onOpenFile]);

  return <div ref={hostRef} className="editor-host" />;
}
