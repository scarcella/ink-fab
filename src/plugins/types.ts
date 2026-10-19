import type { EditorState, Extension, Range } from '@codemirror/state';
import type { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

export interface PluginContext {
  state: EditorState;
  filePath: string | null;
  touches: (from: number, to: number) => boolean;
  inCode: (pos: number) => boolean;
}

export interface NodeRenderer {
  node: string;
  render: (node: SyntaxNode, ctx: PluginContext) => Range<Decoration>[] | null;
}

export interface ScanRenderer {
  pattern: RegExp;
  render: (m: RegExpExecArray, ctx: PluginContext) => Range<Decoration>[] | null;
}

export interface FencedLangRenderer {
  /** Exact lang string(s), or a predicate for open-ended sets (e.g. "anything highlight.js knows"). */
  lang: string | string[] | ((lang: string) => boolean);
  /** Return null to decline — the fence stays as styled source lines. */
  toWidget: (body: string, lang: string, ctx: PluginContext) => WidgetType | null;
}

/** An action a plugin offers: bound to `key` and listed in the / menu. */
export interface Command {
  name: string;
  /** CodeMirror key name, e.g. 'Mod-Shift-9'. */
  key?: string;
  /** Extra words the / menu matches, e.g. ['todo'] for "Checklist". */
  aliases?: string[];
  run: (view: EditorView) => boolean;
}

export type Transform = (content: string, filePath: string) => string;

export interface InkFabPlugin {
  readonly name: string;
  readonly styles?: string;
  readonly extensions?: Extension[];
  readonly nodes?: NodeRenderer[];
  readonly scans?: ScanRenderer[];
  readonly fencedLangs?: FencedLangRenderer[];
  readonly commands?: Command[];
  readonly onOpen?: Transform;
  readonly onSave?: Transform;
}
