import { runAiMailActionSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

type StreamMetaPayload = {
  aiMessageId: string;
  action: string;
  structuredOutput: unknown;
  humanApprovalRequired: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type StreamChunkPayload = {
  content: string;
};

type StreamDonePayload = {
  completed: true;
};

type StreamErrorPayload = {
  code: string;
  message: string;
};

function formatSse(
  event: string,
  payload: StreamMetaPayload | StreamChunkPayload | StreamDonePayload | StreamErrorPayload
) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = runAiMailActionSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.AI_WORKSPACE
    );
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.MAIL_AI_COMPOSE
    );

    const result = await services.aiService.runMailAction(session.userId, {
      ...payload,
      stream: true
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          controller.enqueue(
            encoder.encode(
              formatSse("meta", {
                aiMessageId: result.aiMessageId,
                action: result.action,
                structuredOutput: result.structuredOutput,
                humanApprovalRequired: result.humanApprovalRequired,
                usage: result.usage
              })
            )
          );

          for await (const chunk of services.aiService.streamSuggestion(result.suggestion)) {
            controller.enqueue(
              encoder.encode(
                formatSse("chunk", {
                  content: chunk
                })
              )
            );
          }

          controller.enqueue(
            encoder.encode(
              formatSse("done", {
                completed: true
              })
            )
          );
          controller.close();
        } catch (streamError) {
          const message = streamError instanceof Error ? streamError.message : "AI stream kesildi";
          controller.enqueue(
            encoder.encode(
              formatSse("error", {
                code: "STREAM_ERROR",
                message
              })
            )
          );
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (error) {
    return fail(error);
  }
}
