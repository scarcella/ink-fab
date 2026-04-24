// Strip OpenAI/ChatGPT citation + entity markers that use private-use-area
// Unicode characters (U+E000–U+F8FF) as delimiters.
//
// Shapes observed in ChatGPT markdown exports:
//   <PUA>cite<PUA>turn25search0<PUA>turn26search1<PUA>  → tool-call citation run
//   <PUA>entity<PUA>["organization","LCIA","..."]<PUA>   → entity tag
//
// Citations are dropped entirely. Entity tags collapse to their first quoted
// value (the human-readable name).

const PUA = '[\\uE000-\\uF8FF]';
const CITATION_RE = new RegExp(`${PUA}cite${PUA}(?:turn\\d+(?:search|view)\\d+${PUA}?)+`, 'g');
const ENTITY_RE = new RegExp(`${PUA}entity${PUA}\\["[^"]*","([^"]*)"[^\\]]*\\]${PUA}`, 'g');
const STRAY_PUA_RE = new RegExp(PUA, 'g');

export function hasOpenAICitations(src: string): boolean {
  STRAY_PUA_RE.lastIndex = 0;
  return STRAY_PUA_RE.test(src);
}

export function stripOpenAICitations(src: string): string {
  return src
    .replace(ENTITY_RE, '$1')
    .replace(CITATION_RE, '')
    .replace(STRAY_PUA_RE, '')
    .replace(/[ \t]+$/gm, '');
}
