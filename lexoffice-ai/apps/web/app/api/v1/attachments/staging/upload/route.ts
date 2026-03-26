import { fail, ok } from "@/lib/http";
import { UnauthorizedError } from "@lexoffice/core";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function PUT(request: Request) {
  try {
    const session = await getServerSession();

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    if (!token) {
      throw new UnauthorizedError("Upload token eksik");
    }

    const arrayBuffer = await request.arrayBuffer();
    const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();

    const result = await services.attachmentSecurityService.uploadStagedFile(
      session.userId,
      token,
      Buffer.from(arrayBuffer),
      contentType
    );

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
