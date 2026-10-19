import type { InkFabPlugin } from './types';
import { markHiding } from './mark-hiding';
import { headings } from './headings';
import { toc } from './toc';
import { blockquotes } from './blockquotes';
import { fencedCode } from './fenced-code';
import { highlight } from './highlight';
import { mermaid } from './mermaid';
import { tables } from './tables';
import { tasks } from './tasks';
import { lists } from './lists';
import { listToggle } from './list-toggle';
import { images } from './images';
import { links } from './links';
import { horizontalRule } from './horizontal-rule';
import { math } from './math';
import { openaiCitations } from './openai-citations';
import { slashMenu } from './slash-menu';

// The single source of truth for what InkFab renders. Add a plugin: add a
// file, add a line. Disable one: comment its line out.
//
// Ordering notes:
//  - `mermaid` must precede `highlight` in spirit: both claim fenced code,
//    but mermaid matches the exact lang while highlight uses a predicate,
//    and exact langs always win — so order doesn't actually matter there.
//  - `headings` and `toc` share the heading collection (lib/headings), so
//    ids and toc entries can't drift apart regardless of order.
export const plugins: InkFabPlugin[] = [
  markHiding(),
  headings(),
  toc(),
  blockquotes(),
  fencedCode(),
  highlight(),
  mermaid(),
  tables(),
  tasks(),
  lists(),
  listToggle(),
  images(),
  links(),
  horizontalRule(),
  math(),
  openaiCitations(),
  slashMenu(),
];

export type { InkFabPlugin } from './types';
export {
  createPluginExtension,
  applyOpenTransforms,
  applySaveTransforms,
} from './runtime';
