/** Literal, Unicode-aware matching. Replacement text is never interpreted as a
 * regular expression or as $-substitution syntax. */
export function literalPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}
export function replaceText(
  text: string,
  query: string,
  replacement: string,
): string {
  return query ? text.replace(literalPattern(query), () => replacement) : text;
}
