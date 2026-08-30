import "reflect-metadata";
import "./load-env.ts";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.ts";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? "http://127.0.0.1:3000,http://localhost:3000")
      .split(",")
      .map((item) => item.trim()),
  });
  app.enableShutdownHooks();

  const port = Number(process.env.NEST_API_PORT ?? 3001);
  const host = process.env.API_HOST ?? "127.0.0.1";
  await app.listen(port, host);
  console.log(`healthAgent Nest API listening on http://${host}:${port}/api`);
}

void bootstrap();
