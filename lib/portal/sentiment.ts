const riskKeywords = ['tehdit', 'şikayet edeceğim', 'savcılık', 'dolandırıcılık', 'öfkeliyim', 'hukuki işlem'];

export function detectRiskySentiment(message: string): { isRisky: boolean; matched: string[] } {
  const normalized = message.toLocaleLowerCase('tr-TR');
  const matched = riskKeywords.filter((keyword) => normalized.includes(keyword));
  return {
    isRisky: matched.length > 0,
    matched,
  };
}
