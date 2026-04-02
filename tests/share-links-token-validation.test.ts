import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ShareLinksService } from "@/apps/api/src/share-links/share-links.service";

function createService() {
  const prisma = {
    shareLink: {
      findUnique: vi.fn(),
    },
  };
  const auditService = {
    write: vi.fn(),
  };

  const service = new ShareLinksService(prisma as any, auditService as any);
  return { service, prisma, auditService };
}

describe("share link public token validation", () => {
  it("returns 400 for invalid token format in resolvePublic", async () => {
    const { service, prisma } = createService();

    await expect(service.resolvePublic("invalid-token")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.shareLink.findUnique).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid token format in createPublicComment", async () => {
    const { service, prisma } = createService();

    await expect(
      service.createPublicComment(
        "short-token",
        { authorName: "Ali", body: "Merhaba" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.shareLink.findUnique).not.toHaveBeenCalled();
  });

  it("accepts valid token format and continues to lookup", async () => {
    const { service, prisma } = createService();
    prisma.shareLink.findUnique.mockResolvedValue(null);

    await expect(service.resolvePublic("A".repeat(32))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.shareLink.findUnique).toHaveBeenCalledTimes(1);
  });
});
