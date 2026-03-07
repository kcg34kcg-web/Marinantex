import { randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import type { PrismaClient } from "@lexoffice/db";
import {
  addDomainSchema,
  listDomainsSchema,
  verifyDomainSchema,
  type AddDomainInput,
  type ListDomainsInput,
  type VerifyDomainInput
} from "@lexoffice/contracts";
import { ConflictError, NotFoundError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";
import { buildDomainDnsTemplate } from "./domain-dns";

const dnsResolver = new Resolver();

type DomainVerificationRecordResult = {
  id: string;
  type: string;
  host: string;
  expected: string;
  verified: boolean;
  details?: string;
};

export class DomainService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService,
    private readonly resolver: Resolver = dnsResolver
  ) {}

  async addDomain(actorUserId: string, payload: AddDomainInput) {
    const input = addDomainSchema.parse(payload);
    const domainName = normalizeDomainName(input.domainName);

    const existing = await this.prisma.domain.findUnique({
      where: {
        tenantId_domainName: {
          tenantId: input.tenantId,
          domainName
        }
      }
    });

    if (existing && !existing.deletedAt) {
      throw new ConflictError("Bu domain tenant içinde zaten kayıtlı");
    }

    const verificationToken = randomBytes(18).toString("hex");
    const template = buildDomainDnsTemplate({
      domainName,
      provider: input.provider,
      verificationToken
    });

    const domain = await this.prisma.$transaction(async (tx) => {
      const created =
        existing && existing.deletedAt
          ? await tx.domain.update({
              where: { id: existing.id },
              data: {
                provider: input.provider,
                onboardingMode: input.mode,
                status: "PENDING_VERIFICATION",
                verificationToken,
                deletedAt: null
              }
            })
          : await tx.domain.create({
              data: {
                tenantId: input.tenantId,
                domainName,
                provider: input.provider,
                onboardingMode: input.mode,
                status: "PENDING_VERIFICATION",
                verificationToken
              }
            });

      if (existing && existing.deletedAt) {
        await tx.domainDnsRecord.deleteMany({
          where: { domainId: created.id }
        });
      }

      await tx.domainDnsRecord.createMany({
        data: template.map((record) => ({
          tenantId: input.tenantId,
          domainId: created.id,
          type: record.type,
          host: record.host,
          value: record.value,
          priority: record.priority ?? null,
          ttl: record.ttl ?? null,
          required: record.required
        }))
      });

      await tx.domainVerification.create({
        data: {
          tenantId: input.tenantId,
          domainId: created.id,
          verificationType: "DNS_BOOTSTRAP",
          status: "PENDING",
          details: {
            provider: input.provider,
            mode: input.mode,
            recordCount: template.length
          }
        }
      });

      return created;
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "domain.added",
      resourceType: "domain",
      resourceId: domain.id,
      metadata: {
        domainName,
        provider: input.provider,
        mode: input.mode
      }
    });

    return this.getDomain(input.tenantId, domain.id);
  }

  async listDomains(payload: ListDomainsInput) {
    const input = listDomainsSchema.parse(payload);

    return this.prisma.domain.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.status ? { status: input.status } : {})
      },
      orderBy: { createdAt: "desc" },
      include: {
        dnsRecords: {
          orderBy: [{ required: "desc" }, { type: "asc" }]
        },
        mailboxes: {
          where: { deletedAt: null },
          select: {
            id: true,
            email: true,
            status: true,
            provider: true
          }
        }
      }
    });
  }

  async getDomain(tenantId: string, domainId: string) {
    const domain = await this.prisma.domain.findFirst({
      where: {
        id: domainId,
        tenantId,
        deletedAt: null
      },
      include: {
        dnsRecords: {
          orderBy: [{ required: "desc" }, { type: "asc" }]
        },
        verifications: {
          orderBy: { createdAt: "desc" },
          take: 10
        },
        mailboxes: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!domain) {
      throw new NotFoundError("Domain bulunamadı");
    }

    return domain;
  }

  async verifyDomain(actorUserId: string, payload: VerifyDomainInput) {
    const input = verifyDomainSchema.parse(payload);

    const domain = await this.getDomain(input.tenantId, input.domainId);
    const checkedAt = new Date();

    const recordResults: DomainVerificationRecordResult[] = [];

    for (const record of domain.dnsRecords) {
      const verification = await this.verifyDnsRecord(domain.domainName, record.type, record.host, record.value);
      recordResults.push({
        id: record.id,
        type: record.type,
        host: record.host,
        expected: record.value,
        verified: verification.verified,
        ...(verification.details === undefined ? {} : { details: verification.details })
      });
    }

    await this.prisma.$transaction(async (tx) => {
      for (const recordResult of recordResults) {
        await tx.domainDnsRecord.update({
          where: { id: recordResult.id },
          data: {
            verified: recordResult.verified,
            lastCheckedAt: checkedAt
          }
        });
      }

      const requiredResults = recordResults.filter((record) =>
        domain.dnsRecords.find((dns) => dns.id === record.id)?.required
      );

      const verificationRecordOk = recordResults.some(
        (record) => record.host === "_lexoffice-verification" && record.verified
      );
      const requiredReady = requiredResults.length > 0 && requiredResults.every((record) => record.verified);

      const nextStatus = !verificationRecordOk
        ? "PENDING_VERIFICATION"
        : requiredReady
          ? "MAIL_READY"
          : domain.status === "MAIL_READY"
            ? "MISCONFIGURED"
            : "VERIFIED";

      await tx.domain.update({
        where: { id: domain.id },
        data: {
          status: nextStatus,
          verifiedAt: verificationRecordOk ? checkedAt : null,
          mailReadyAt: requiredReady ? checkedAt : null,
          lastHealthCheckAt: checkedAt
        }
      });

      await tx.domainVerification.create({
        data: {
          tenantId: input.tenantId,
          domainId: domain.id,
          verificationType: "DNS_CHECK",
          status: requiredReady ? "SUCCESS" : verificationRecordOk ? "PARTIAL" : "FAILED",
          checkedAt,
          details: {
            status: nextStatus,
            records: recordResults
          }
        }
      });
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "domain.verified",
      resourceType: "domain",
      resourceId: domain.id,
      metadata: {
        checkedAt: checkedAt.toISOString(),
        verifiedRecords: recordResults.filter((record) => record.verified).length,
        totalRecords: recordResults.length
      }
    });

    return this.getDomain(input.tenantId, domain.id);
  }

  private async verifyDnsRecord(
    domainName: string,
    type: "MX" | "TXT" | "CNAME" | "SPF" | "DKIM" | "DMARC",
    host: string,
    expectedValue: string
  ): Promise<{ verified: boolean; details?: string }> {
    const fqdn = toFqdn(host, domainName);
    const expected = normalizeRecordValue(expectedValue);

    try {
      if (type === "MX") {
        const mx = await this.resolver.resolveMx(fqdn);
        const matched = mx.some(
          (entry) => normalizeRecordValue(entry.exchange) === expected || normalizeRecordValue(entry.exchange) === `${expected}.${domainName}`
        );

        return {
          verified: matched,
          details: matched ? "MX kaydı eşleşti" : "MX kaydı bulunamadı"
        };
      }

      if (type === "CNAME" || type === "DKIM") {
        const cname = await this.resolver.resolveCname(fqdn);
        const matched = cname.some((entry) => normalizeRecordValue(entry) === expected);
        return {
          verified: matched,
          details: matched ? "CNAME kaydı eşleşti" : "CNAME kaydı bulunamadı"
        };
      }

      const txtRecords = await this.resolver.resolveTxt(fqdn);
      const flattened = txtRecords.map((entry) => normalizeRecordValue(entry.join("")));
      const matched = flattened.some((entry) => entry.includes(expected));

      return {
        verified: matched,
        details: matched ? "TXT kaydı eşleşti" : `TXT kaydı bulunamadı (${flattened.join(" | ") || "boş"})`
      };
    } catch (error) {
      return {
        verified: false,
        details: error instanceof Error ? error.message : "DNS sorgusu başarısız"
      };
    }
  }
}

function toFqdn(host: string, domainName: string): string {
  if (host === "@") {
    return domainName;
  }

  return `${host}.${domainName}`;
}

function normalizeRecordValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeDomainName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}
