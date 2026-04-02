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

// 1. ADIM: Vercel için uygulamanın hafızada tutulacağı değişken
let cachedServer: any;

async function bootstrap() {
  // Eğer uygulama zaten çalışıyorsa tekrar kurmasını engelliyoruz
  if (!cachedServer) {
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

    // 2. ADIM: Vercel'de port dinlemeyiz, sadece uygulamayı başlatırız (init)
    await app.init();
    
    // expressApp'i önbelleğe alıyoruz
    cachedServer = expressApp;
  }

  return cachedServer;
}

// 3. ADIM: Eski `void bootstrap();` satırını sildik ve yerine bunu ekledik.
// Vercel'in uygulamamıza gelen web isteklerini (req, res) ilettiği ana fonksiyon budur.
export default async function handler(req: any, res: any) {
  const server = await bootstrap();
  return server(req, res);
}