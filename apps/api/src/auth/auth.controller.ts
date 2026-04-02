import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { JwtAuthGuard } from "../security/guards/jwt-auth.guard";
import type { AuthenticatedRequest } from "../security/types/authenticated-request.type";
import {
  ACCESS_TOKEN_COOKIE,
  TENANT_ID_COOKIE,
} from "../security/utils/cookies";

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function resolveAuthCookieOptions() {
  const secureCookie = envFlag(
    "AUTH_COOKIE_SECURE",
    process.env.NODE_ENV === "production",
  );
  const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;

  return {
    secure: secureCookie,
    sameSite: "lax" as const,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body);
    const cookieOptions = resolveAuthCookieOptions();

    res.cookie(ACCESS_TOKEN_COOKIE, result.accessToken, {
      httpOnly: true,
      ...cookieOptions,
    });
    res.cookie(TENANT_ID_COOKIE, result.user.tenantId, {
      httpOnly: true,
      ...cookieOptions,
    });

    return result;
  }

  @Post("logout")
  async logout(@Res({ passthrough: true }) res: Response) {
    const cookieOptions = resolveAuthCookieOptions();
    res.clearCookie(ACCESS_TOKEN_COOKIE, cookieOptions);
    res.clearCookie(TENANT_ID_COOKIE, cookieOptions);

    return { success: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    return {
      user: req.user,
      tenantId: req.tenantId ?? null,
    };
  }
}
