import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import os from 'os';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;
  const apiPrefix = configService.get<string>('apiPrefix') || 'api/v1';

  // Global prefix
  app.setGlobalPrefix(apiPrefix, {
    exclude: ['health', 'health/ping'],
  });

  // Security
  app.use(helmet());

  // Compression
  app.use(compression());

  // Cookie parser
  app.use(cookieParser());

  // CORS — permissive for local testing
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  // DEBUG: Log all incoming REST requests
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[REST] ${req.method.padEnd(6)} ${req.url}`);
    next();
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Graceful shutdown
  app.enableShutdownHooks();

  // Bind to 0.0.0.0 so it's accessible from other devices on the network
  await app.listen(port, '0.0.0.0');

  // Get local IPv4 address for network access
  const getLocalIp = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const ifaces = interfaces[name];
      if (!ifaces) continue;
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'N/A';
  };

  const localIp = getLocalIp();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('🚀 TAKATAK BACKEND — READY FOR TESTING');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Server binding: 0.0.0.0:${port}`);
  console.log(`CORS: permissive (origin: true)`);
  console.log(`Environment: ${configService.get('nodeEnv')}`);
  console.log('');
  console.log('🌐 Access URLs:');
  console.log(`   → http://localhost:${port}/health (local machine)`);
  console.log(`   → http://${localIp}:${port}/health (network device)`);
  console.log('');
  console.log(`📍 API Prefix: ${apiPrefix}`);
  console.log(`🔌 WebSocket: /chat (with Redis adapter)`);
  console.log('═══════════════════════════════════════════════════════\n');
}

bootstrap();
