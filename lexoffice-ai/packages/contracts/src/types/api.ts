export type ApiSuccess<T> = {
  ok: true;
  data: T;
  requestId?: string;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
