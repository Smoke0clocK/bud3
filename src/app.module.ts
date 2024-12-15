import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordService } from './platforms/discord.service';
import { TelegramService } from './platforms/telegram.service';
import { PrismaService } from './services/prisma.service';
import { MessageBrokerService } from './services/message-broker.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  providers: [
    PrismaService,
    MessageBrokerService,
    DiscordService,
    TelegramService,
  ],
})
export class AppModule {}
