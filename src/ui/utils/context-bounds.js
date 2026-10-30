export function describeTaskContextBounds(bounds) {
  if (!bounds) return '';
  const parts = [];
  if (bounds.documentsTruncated) {
    const omitted = Array.isArray(bounds.omittedDocuments) ? bounds.omittedDocuments.length : 0;
    const cap = Number.isFinite(bounds.documentCap) ? ` (cap ${bounds.documentCap})` : '';
    parts.push(`${omitted} linked document(s) omitted${cap}`);
  }
  if (bounds.sessionsTruncated) {
    const omitted = Array.isArray(bounds.omittedSessions) ? bounds.omittedSessions.length : 0;
    const cap = Number.isFinite(bounds.sessionCap) ? ` (cap ${bounds.sessionCap})` : '';
    parts.push(`${omitted} session(s) omitted${cap}`);
  }
  return parts.join('; ');
}

export function withContextBoundsNotice(base, bounds) {
  const extra = describeTaskContextBounds(bounds);
  return extra ? `${base}. ${extra}` : base;
}
