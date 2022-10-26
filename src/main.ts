import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';

import { AppModule } from './app.module';
// import validationOptions from './utils/validation-options';
import rawBodyMiddleware from './stripe/raw-body.middleware';
import { PrismaService } from './prisma.service';
// import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'https://card-viewer.vercel.app',
      'https://sailspad-card-viewer-bitsbysalih.vercel.app',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5500',
      'http://192.168.1.108:5173',
      'https://sailspad-card-viewer.vercel.app',
      'https://sailspad-client-dev.vercel.app',
      'https://www.sailspad.com',
      'https://cards.sailspad.com',
      'https://app.sailspad.com',
      'https://ebc.sailspad.com',
    ],
  });
  const prismaService = app.get(PrismaService);
  await prismaService.enableShutdownHooks(app);

  const configService = app.get(ConfigService);

  //   app.use(rawBodyMiddleware());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  app.setGlobalPrefix(configService.get('app.apiPrefix'), {
    exclude: ['/'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
  });

  const options = new DocumentBuilder()
    .setTitle('API')
    .setDescription('API docs')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document);
  await app.listen(configService.get('app.port'));
}
bootstrap();
