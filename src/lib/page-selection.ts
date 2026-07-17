export function selectActivePath(
  imagePath: string | null | undefined,
  documentPath: string | null | undefined,
): string | undefined {
  return (imagePath ?? documentPath) || undefined;
}
