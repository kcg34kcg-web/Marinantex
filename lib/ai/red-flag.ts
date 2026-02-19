const redFlagKeywords = ['hapis cezası', 'reddedildi', 'mahkûmiyet', 'ceza aldı', 'tutuklama'];

export function hasRedFlag(text: string): boolean {
  const normalized = text.toLocaleLowerCase('tr-TR');
  return redFlagKeywords.some((keyword) => normalized.includes(keyword));
}

export function getRedFlagKeywords(): string[] {
  return redFlagKeywords;
}
