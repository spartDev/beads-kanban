/** Assemble des noms de classes en ignorant les valeurs vides. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
