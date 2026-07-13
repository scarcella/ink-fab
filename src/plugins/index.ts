import type { InkFabPlugin } from './types';
import { openaiCitations } from './openai-citations';

export const plugins: InkFabPlugin[] = [
  openaiCitations(),
];

export type { InkFabPlugin } from './types';
export {
  createPluginExtension,
  applyOpenTransforms,
  applySaveTransforms,
} from './runtime';
