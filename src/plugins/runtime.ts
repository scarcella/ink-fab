import { syntaxTree } from '@codemirror/language';
import {
  EditorState,
  Extension,
  Range,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Prec } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, keymap } from '@codemirror/view';
import { commandsFacet } from './lib/commands';
import type {
  FencedLangRenderer,
  InkFabPlugin,
  NodeRenderer,
  PluginContext,
  ScanRenderer,
} from './types';

const focusEffect = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(focusEffect)) return e.value;
    return value;
  },
});

const focusTracker = EditorView.focusChangeEffect.of((_state, focusing) =>
  focusEffect.of(focusing)
);

const injectedStyles = new Set<string>();
function injectStyleOnce(name: string, css: string) {
  if (injectedStyles.has(name)) return;
  injectedStyles.add(name);
  if (typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-inkfab-plugin', name);
  el.textContent = css;
  document.head.appendChild(el);
}

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[inkfab plugin]', err);
    return null;
  }
}

function indexNodes(plugins: InkFabPlugin[]): Map<string, NodeRenderer[]> {
  const map = new Map<string, NodeRenderer[]>();
  for (const p of plugins) {
    for (const n of p.nodes ?? []) {
      const list = map.get(n.node) ?? [];
      list.push(n);
      map.set(n.node, list);
    }
  }
  return map;
}

type FencedIndex = {
  exact: Map<string, FencedLangRenderer>;
  predicates: FencedLangRenderer[];
};

function indexFenced(plugins: InkFabPlugin[]): FencedIndex {
  const exact = new Map<string, FencedLangRenderer>();
  const predicates: FencedLangRenderer[] = [];
  for (const p of plugins) {
    for (const f of p.fencedLangs ?? []) {
      if (typeof f.lang === 'function') {
        predicates.push(f);
      } else {
        const langs = Array.isArray(f.lang) ? f.lang : [f.lang];
        for (const l of langs) exact.set(l.toLowerCase(), f);
      }
    }
  }
  return { exact, predicates };
}

// Exact langs win over predicates; predicates run in registry order.
function findFenced(idx: FencedIndex, lang: string): FencedLangRenderer | null {
  const hit = idx.exact.get(lang);
  if (hit) return hit;
  for (const f of idx.predicates) {
    if ((f.lang as (l: string) => boolean)(lang)) return f;
  }
  return null;
}

function parseFence(state: EditorState, from: number, to: number) {
  const raw = state.doc.sliceString(from, to);
  const match = raw.match(/^```\s*([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)\n?```\s*$/);
  if (!match) return null;
  return { lang: match[1].toLowerCase(), body: match[2] };
}

function makeContext(
  state: EditorState,
  filePath: string | null,
  codeRanges: Array<[number, number]>
): PluginContext {
  const sel = state.selection.main;
  const focused = state.field(focusField, false) ?? false;
  return {
    state,
    filePath,
    touches: (from, to) => focused && sel.from <= to && sel.to >= from,
    inCode: (pos) => codeRanges.some(([f, t]) => pos >= f && pos < t),
  };
}

function build(
  state: EditorState,
  plugins: InkFabPlugin[],
  filePath: string | null
): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const codeRanges: Array<[number, number]> = [];
  const nodeIdx = indexNodes(plugins);
  const fencedIdx = indexFenced(plugins);

  const tree = syntaxTree(state);
  const docLen = state.doc.length;

  tree.iterate({
    from: 0,
    to: docLen,
    enter: (node) => {
      const { name, from, to } = node;
      if (name === 'InlineCode' || name === 'FencedCode' || name === 'CodeBlock') {
        codeRanges.push([from, to]);
      }
    },
  });

  const ctx = makeContext(state, filePath, codeRanges);

  tree.iterate({
    from: 0,
    to: docLen,
    enter: (node) => {
      const { name, from, to } = node;

      if (name === 'FencedCode' && !ctx.touches(from, to)) {
        const parsed = parseFence(state, from, to);
        if (parsed) {
          const handler = findFenced(fencedIdx, parsed.lang);
          if (handler) {
            const widget = safely(() => handler.toWidget(parsed.body, parsed.lang, ctx));
            if (widget) {
              decos.push(
                Decoration.replace({ widget, block: true }).range(from, to)
              );
            }
          }
        }
      }

      const handlers = nodeIdx.get(name);
      if (handlers) {
        for (const h of handlers) {
          const ranges = safely(() => h.render(node.node, ctx));
          if (ranges) decos.push(...ranges);
        }
      }
    },
  });

  const text = state.doc.toString();
  for (const p of plugins) {
    for (const scan of p.scans ?? []) {
      scan.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = scan.pattern.exec(text))) {
        if (ctx.inCode(m.index)) continue;
        if (ctx.touches(m.index, m.index + m[0].length)) continue;
        const ranges = safely(() => scan.render(m!, ctx));
        if (ranges) decos.push(...ranges);
      }
    }
  }

  return Decoration.set(decos, true);
}

export function createPluginExtension(
  plugins: InkFabPlugin[],
  filePath: string | null
): Extension {
  plugins.forEach((p) => p.styles && injectStyleOnce(p.name, p.styles));

  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, plugins, filePath),
    update: (v, tr) => {
      const focusChanged = tr.effects.some((e) => e.is(focusEffect));
      if (tr.docChanged || tr.selection || focusChanged) {
        return build(tr.state, plugins, filePath);
      }
      return v;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Commands get their key bound here and are published for the / menu.
  // High precedence so they win over the stock keymap (Mod-Enter etc.).
  const commands = plugins.flatMap((p) => p.commands ?? []);
  const bindings = commands
    .filter((c) => c.key)
    .map((c) => ({ key: c.key!, run: (view: EditorView) => safely(() => c.run(view)) ?? false }));

  return [
    focusField,
    focusTracker,
    field,
    commandsFacet.of(commands),
    Prec.high(keymap.of(bindings)),
    ...plugins.flatMap((p) => p.extensions ?? []),
  ];
}

export const applyOpenTransforms = (
  content: string,
  filePath: string,
  plugins: InkFabPlugin[]
): string =>
  plugins.reduce(
    (acc, p) => (p.onOpen ? p.onOpen(acc, filePath) : acc),
    content
  );

export const applySaveTransforms = (
  content: string,
  filePath: string,
  plugins: InkFabPlugin[]
): string =>
  plugins.reduce(
    (acc, p) => (p.onSave ? p.onSave(acc, filePath) : acc),
    content
  );
