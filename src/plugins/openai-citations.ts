import type { InkFabPlugin } from './types';
import { hasOpenAICitations, stripOpenAICitations } from '../openaiCitations';

export function openaiCitations(): InkFabPlugin {
  return {
    name: 'openai-citations',
    onOpen: (content) =>
      hasOpenAICitations(content) ? stripOpenAICitations(content) : content,
  };
}
