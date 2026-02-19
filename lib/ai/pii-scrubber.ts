const turkishFullNamePattern = /\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,}\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,})\b/g;
const tcIdPattern = /\b[1-9]\d{10}\b/g;

export interface PiiMappings {
  tcIdMap: Map<string, string>;
  personMap: Map<string, string>;
}

export interface ScrubResult {
  text: string;
  mappings: PiiMappings;
}

export function scrubPii(rawText: string): ScrubResult {
  const tcIdMap = new Map<string, string>();
  const personMap = new Map<string, string>();

  let tcCounter = 1;
  let personCounter = 1;

  const textWithTcMask = rawText.replace(tcIdPattern, (match) => {
    if (!tcIdMap.has(match)) {
      tcIdMap.set(match, `[TC_ID_${tcCounter}]`);
      tcCounter += 1;
    }
    return tcIdMap.get(match) ?? '[TC_ID]';
  });

  const scrubbedText = textWithTcMask.replace(turkishFullNamePattern, (match) => {
    if (!personMap.has(match)) {
      personMap.set(match, `[PERSON_${personCounter}]`);
      personCounter += 1;
    }
    return personMap.get(match) ?? '[PERSON_1]';
  });

  return {
    text: scrubbedText,
    mappings: {
      tcIdMap,
      personMap,
    },
  };
}

export function restorePii(text: string, mappings: PiiMappings): string {
  let restored = text;

  for (const [value, token] of mappings.tcIdMap.entries()) {
    restored = restored.split(token).join(value);
  }

  for (const [value, token] of mappings.personMap.entries()) {
    restored = restored.split(token).join(value);
  }

  return restored;
}
