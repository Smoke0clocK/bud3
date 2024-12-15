import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bud-3');
  
  try {
    logger.log('Starting Bud-3...');
    const app = await NestFactory.create(AppModule);
    await app.init();
    logger.log('Bud-3 initialized, connecting to database...');
    logger.log('🤖 Bud-3 is online!');
  } catch (error) {
    logger.error('Failed to start Bud-3:', error);
    process.exit(1);
  }
}

bootstrap();
