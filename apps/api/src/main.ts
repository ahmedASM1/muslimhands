import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService<AppConfig, true>);
  const logger = new Logger('Bootstrap');
  const nodeEnv = configService.get('nodeEnv', { infer: true });
  const webOrigin = configService.get('webOrigin', { infer: true });

  if (nodeEnv === 'production' && (webOrigin === '*' || !webOrigin.trim())) {
    throw new Error('Unsafe CORS configuration: WEB_ORIGIN must be an explicit origin in production');
  }

  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Medicine Distribution API')
      .setDescription(
        'REST API for the Central Warehouse and Pharmacy medicine distribution system. Dispensing is free of charge; internal warehouse-to-pharmacy movement is a stock transfer, not an invoice.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger enabled (non-production)');
  }

  const port = configService.get('port', { infer: true });
  const host = configService.get('host', { infer: true });
  await app.listen(port, host);
  logger.log(`API listening on http://${host}:${port}`);
  if (nodeEnv !== 'production') {
    logger.log(`Swagger available at http://localhost:${port}/api/docs`);
  }
}

void bootstrap();
