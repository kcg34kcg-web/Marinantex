import { NextResponse } from "next/server";
import { PERMISSIONS, UnauthorizedError } from "@lexoffice/core";
import { fail } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    if (!session.tenantId) {
      throw new UnauthorizedError("Tenant bağlamı bulunamadı");
    }

    await services.rbacService.requirePermission(session.userId, session.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (!token) {
      throw new Error("Download token eksik");
    }

    const file = await services.attachmentSecurityService.downloadAttachmentByToken(session.userId, token);

    if (file.kind === "redirect") {
      return NextResponse.redirect(file.redirectUrl, {
        status: 302,
        headers: {
          "Cache-Control": "private, no-store"
        }
      });
    }

    const safeFileName = encodeURIComponent(file.fileName);
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `attachment; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return fail(error);
  }
}
