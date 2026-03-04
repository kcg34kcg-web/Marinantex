export function createPublicRefCode(prefix: string): string {
  const normalizedPrefix = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'REF';

  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `${normalizedPrefix}-${token}`;
}

