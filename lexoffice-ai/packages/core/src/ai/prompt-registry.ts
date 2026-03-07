export const PROMPT_REGISTRY = {
  MAIL_SUMMARY: {
    tr: "Aşağıdaki e-postayı profesyonel hukuk ofisi asistanı tonu ile 5 maddeyi geçmeyecek şekilde özetle.",
    en: "Summarize the following email in no more than 5 bullets with a law-office professional tone."
  },
  MAIL_REPLY_PROFESSIONAL: {
    tr: "Aşağıdaki e-postaya profesyonel, net ve kurumsal bir yanıt taslağı üret.",
    en: "Draft a professional, clear and corporate email reply."
  },
  MAIL_REPLY_SHORT: {
    tr: "Aşağıdaki e-postaya kısa bir yanıt taslağı üret.",
    en: "Draft a short reply to the email below."
  },
  MAIL_REPLY_FORMAL: {
    tr: "Aşağıdaki e-postaya resmi ve mesafeli bir yanıt taslağı üret.",
    en: "Draft a formal and reserved reply to the email below."
  },
  THREAD_TASK_EXTRACTION: {
    tr: "Aşağıdaki yazışmadan yapılacak görevleri çıkar ve sorumlu/tarih öner.",
    en: "Extract actionable tasks from the thread and suggest owner/due date."
  },
  THREAD_ACTION_LIST: {
    tr: "Aşağıdaki yazışma için aksiyon listesini çıkar.",
    en: "Generate an action checklist for the thread."
  },
  THREAD_MATTER_SUMMARY: {
    tr: "Yazışmayı müvekkil dosyasına eklemek için konu, risk ve sonraki adımlar özeti üret.",
    en: "Create a client-matter summary with topic, risk and next steps."
  },
  SENSITIVE_DATA_CHECK: {
    tr: "Metindeki hassas veri varlığını (kimlik, IBAN, dava gizli veri) değerlendir.",
    en: "Assess if the text includes sensitive data (identity, bank, legal confidential data)."
  }
} as const;
