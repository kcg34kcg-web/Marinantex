import { NextResponse } from "next/server";
import type { ApiError, ApiSuccess } from "@lexoffice/contracts";
import { AppError } from "@lexoffice/core";

export function ok<T>(data: T, requestId?: string): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({
    ok: true,
    data,
    ...(requestId === undefined ? {} : { requestId })
  });
}

export function fail(error: unknown, requestId?: string): NextResponse<ApiError> {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        },
        ...(requestId === undefined ? {} : { requestId })
      },
      { status: error.statusCode }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Beklenmeyen bir hata oluştu"
      },
      ...(requestId === undefined ? {} : { requestId })
    },
    { status: 500 }
  );
}
