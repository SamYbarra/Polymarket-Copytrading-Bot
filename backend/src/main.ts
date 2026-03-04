import { config } from 'dotenv';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Load backend/.env so PRIVATE_KEY etc. are found even when process is started from repo root
const backendDir = resolve(__dirname, '..');
config({ path: resolve(backendDir, '.env') });

const port = parseInt(process.env.PORT || '3006', 10);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true }); // allow frontend (any origin in dev)
  await app.listen(port);
  console.log(`Backend listening on http://localhost:${port}`);
}
bootstrap();
