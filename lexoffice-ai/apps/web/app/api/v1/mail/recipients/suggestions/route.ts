import { prisma } from "@lexoffice/db";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

type RecipientSuggestion = {
  email: string;
  name: string | null;
  source: "recent" | "contact" | "client";
  lastUsedAt: string | null;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") ?? "";
    const query = (searchParams.get("query") ?? "").trim();
    const limit = normalizeLimit(searchParams.get("limit"));

    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.MAIL_SEND);

    const [recentRecipients, contactRows, clientRows] = await Promise.all([
      prisma.mailRecipient.groupBy({
        by: ["email"],
        where: {
          tenantId,
          ...(query.length > 0
            ? {
                email: {
                  contains: query,
                  mode: "insensitive"
                }
              }
            : {})
        },
        _max: {
          createdAt: true
        },
        orderBy: {
          _max: {
            createdAt: "desc"
          }
        },
        take: limit
      }),
      prisma.contact.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(query.length > 0
            ? {
                OR: [
                  {
                    email: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    fullName: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    firstName: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    lastName: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    company: {
                      contains: query,
                      mode: "insensitive"
                    }
                  }
                ]
              }
            : {})
        },
        select: {
          email: true,
          fullName: true,
          firstName: true,
          lastName: true
        },
        orderBy: [{ updatedAt: "desc" }],
        take: limit
      }),
      prisma.client.findMany({
        where: {
          tenantId,
          deletedAt: null,
          email: {
            not: null
          },
          ...(query.length > 0
            ? {
                OR: [
                  {
                    email: {
                      contains: query,
                      mode: "insensitive"
                    }
                  },
                  {
                    name: {
                      contains: query,
                      mode: "insensitive"
                    }
                  }
                ]
              }
            : {})
        },
        select: {
          email: true,
          name: true
        },
        orderBy: [{ updatedAt: "desc" }],
        take: limit
      })
    ]);

    const recentEmailList = recentRecipients.map((item) => item.email);
    const recentNameRows =
      recentEmailList.length > 0
        ? await prisma.mailRecipient.findMany({
            where: {
              tenantId,
              email: {
                in: recentEmailList
              }
            },
            orderBy: [{ createdAt: "desc" }],
            select: {
              email: true,
              name: true,
              createdAt: true
            }
          })
        : [];

    const recentNameMap = new Map<string, string>();
    for (const row of recentNameRows) {
      const normalized = normalizeEmail(row.email);
      if (!normalized || recentNameMap.has(normalized)) {
        continue;
      }
      const name = row.name?.trim();
      if (name) {
        recentNameMap.set(normalized, name);
      }
    }

    const suggestionsMap = new Map<string, RecipientSuggestion>();

    for (const recent of recentRecipients) {
      const normalized = normalizeEmail(recent.email);
      if (!normalized) {
        continue;
      }

      suggestionsMap.set(normalized, {
        email: recent.email,
        name: recentNameMap.get(normalized) ?? null,
        source: "recent",
        lastUsedAt: recent._max.createdAt ? recent._max.createdAt.toISOString() : null
      });
    }

    for (const contact of contactRows) {
      const normalized = normalizeEmail(contact.email);
      if (!normalized) {
        continue;
      }

      const fullName =
        contact.fullName?.trim() ||
        `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
        null;
      const existing = suggestionsMap.get(normalized);

      if (!existing) {
        suggestionsMap.set(normalized, {
          email: contact.email,
          name: fullName,
          source: "contact",
          lastUsedAt: null
        });
        continue;
      }

      if (!existing.name && fullName) {
        existing.name = fullName;
      }
    }

    for (const client of clientRows) {
      if (!client.email) {
        continue;
      }

      const normalized = normalizeEmail(client.email);
      if (!normalized) {
        continue;
      }

      const existing = suggestionsMap.get(normalized);
      if (!existing) {
        suggestionsMap.set(normalized, {
          email: client.email,
          name: client.name.trim() || null,
          source: "client",
          lastUsedAt: null
        });
        continue;
      }

      if (!existing.name && client.name.trim().length > 0) {
        existing.name = client.name.trim();
      }
    }

    const suggestions = [...suggestionsMap.values()]
      .sort((left, right) => {
        const leftRecent = left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0;
        const rightRecent = right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0;
        if (leftRecent !== rightRecent) {
          return rightRecent - leftRecent;
        }

        const leftName = left.name?.toLowerCase() ?? "";
        const rightName = right.name?.toLowerCase() ?? "";
        if (leftName !== rightName) {
          return leftName.localeCompare(rightName, "tr");
        }

        return left.email.localeCompare(right.email, "tr");
      })
      .slice(0, limit);

    return ok({ suggestions });
  } catch (error) {
    return fail(error);
  }
}

function normalizeLimit(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
