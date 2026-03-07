type MailProvider = "GMAIL" | "MICROSOFT_365" | "YANDEX" | "IMAP_SMTP" | "MANAGED";

type DnsTemplateRecord = {
  type: "MX" | "TXT" | "CNAME" | "SPF" | "DKIM" | "DMARC";
  host: string;
  value: string;
  priority?: number;
  ttl?: number;
  required: boolean;
  description: string;
};

const PROVIDER_SPF: Record<MailProvider, string> = {
  GMAIL: "v=spf1 include:_spf.google.com ~all",
  MICROSOFT_365: "v=spf1 include:spf.protection.outlook.com ~all",
  YANDEX: "v=spf1 include:_spf.yandex.net ~all",
  IMAP_SMTP: "v=spf1 a mx ~all",
  MANAGED: "v=spf1 include:_spf.lexoffice.ai ~all"
};

const PROVIDER_MX: Record<MailProvider, Array<{ value: string; priority: number }>> = {
  GMAIL: [
    { value: "aspmx.l.google.com", priority: 1 },
    { value: "alt1.aspmx.l.google.com", priority: 5 }
  ],
  MICROSOFT_365: [{ value: "tenant-id.mail.protection.outlook.com", priority: 0 }],
  YANDEX: [{ value: "mx.yandex.net", priority: 10 }],
  IMAP_SMTP: [{ value: "mail", priority: 10 }],
  MANAGED: [
    { value: "mx1.lexoffice.ai", priority: 10 },
    { value: "mx2.lexoffice.ai", priority: 20 }
  ]
};

export function buildDomainDnsTemplate(input: {
  domainName: string;
  provider: MailProvider;
  verificationToken: string;
}): DnsTemplateRecord[] {
  const domain = input.domainName.toLowerCase();
  const mxRecords = PROVIDER_MX[input.provider];

  const records: DnsTemplateRecord[] = [
    {
      type: "TXT",
      host: "_lexoffice-verification",
      value: `lexoffice-verification=${input.verificationToken}`,
      required: true,
      ttl: 3600,
      description: "Domain sahiplik doğrulaması"
    },
    {
      type: "SPF",
      host: "@",
      value: PROVIDER_SPF[input.provider],
      required: true,
      ttl: 3600,
      description: "SPF kayıt doğrulaması"
    },
    {
      type: "DKIM",
      host: "selector1._domainkey",
      value:
        input.provider === "GMAIL"
          ? "selector1._domainkey.google"
          : input.provider === "MICROSOFT_365"
            ? "selector1._domainkey.outlook"
            : input.provider === "YANDEX"
              ? "mail._domainkey.yandex.net"
              : `selector1._domainkey.${domain}`,
      required: true,
      ttl: 3600,
      description: "DKIM imza doğrulaması"
    },
    {
      type: "DMARC",
      host: "_dmarc",
      value: "v=DMARC1; p=none; rua=mailto:dmarc@" + domain,
      required: true,
      ttl: 3600,
      description: "DMARC politika kaydı"
    }
  ];

  for (const mx of mxRecords) {
    records.push({
      type: "MX",
      host: "@",
      value: mx.value,
      priority: mx.priority,
      required: true,
      ttl: 3600,
      description: "Gelen mail yönlendirme"
    });
  }

  return records;
}
