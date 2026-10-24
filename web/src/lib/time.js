export function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const units = [
    [86400 * 7, 'w'],
    [86400, 'd'],
    [3600, 'h'],
    [60, 'm'],
  ];
  for (const [sec, label] of units) if (s >= sec) return `${Math.floor(s / sec)}${label}`;
  return 'just now';
}
