import type { EditorState, Extension, Range } from '@codemirror/state';
import type { Decoration, WidgetType } from '@codemirror/view';
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
  lang: string | string[];
  toWidget: (body: string, ctx: PluginContext) => WidgetType | null;
}

export type Transform = (content: string, filePath: string) => string;

export interface InkFabPlugin {
  readonly name: string;
  readonly styles?: string;
  readonly extensions?: Extension[];
  readonly nodes?: NodeRenderer[];
  readonly scans?: ScanRenderer[];
  readonly fencedLangs?: FencedLangRenderer[];
  readonly onOpen?: Transform;
  readonly onSave?: Transform;
}
