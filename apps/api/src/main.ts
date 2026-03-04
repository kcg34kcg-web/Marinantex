import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import compression from "compression";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

function parseCorsOrigins(value: string | undefined): string[] {
  const fallback = ["http://localhost:3000"];
  if (!value || value.trim().length === 0) {
    return fallback;
  }

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return parsed.length > 0 ? parsed : fallback;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.set("trust proxy", 1);
  expressApp.disable("x-powered-by");
  app.enableShutdownHooks();
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(json({ limit: process.env.API_BODY_LIMIT ?? "2mb" }));
  app.use(urlencoded({ extended: true, limit: process.env.API_BODY_LIMIT ?? "2mb" }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-tenant-id", "x-request-id"],
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
