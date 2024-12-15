'use client';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { PrismaService } from '../services/prisma.service';
import { ConfigService } from '@nestjs/config';
import { MessageBrokerService } from '../services/message-broker.service';
import axios from 'axios';

@Injectable()
export class DiscordService implements OnModuleInit {
  private client: Client;
  private logger = new Logger('DiscordService');

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private broker: MessageBrokerService,
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async onModuleInit() {
    try {
      this.client.on('messageCreate', (msg) => this.handleMessage(msg));
      await this.client.login(this.config.get('DISCORD_TOKEN'));
      this.logger.log('Discord bot is online!');

      this.broker.subscribe(async (message) => {
        if (message.platform === 'telegram') {
          await this.handleTelegramMessage(message);
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize Discord service:', error);
    }
  }

  private async handleTelegramMessage(message: any) {
    try {
      const pair = await this.getChannelPair(message);
      if (!pair) return;

      const channel = await this.client.channels.fetch(pair.discordChannel.channelId);
      if (!(channel instanceof TextChannel)) return;

      if (message.attachments) {
        await this.handleTelegramMedia(channel, message);
      } else if (message.content?.trim()) {
        await channel.send(`${message.authorName}: ${message.content}`);
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }

  private async getChannelPair(message: any) {
    const telegramChannel = await this.prisma.channel.findFirst({
      where: { platform: 'telegram', channelId: message.channelId }
    });
    
    if (!telegramChannel) return null;

    const discordChannel = await this.prisma.channel.findFirst({
      where: { platform: 'discord', bridgeId: telegramChannel.bridgeId }
    });

    return discordChannel ? { telegramChannel, discordChannel } : null;
  }

  private async handleTelegramMedia(channel: TextChannel, message: any) {
    try {
      const attachment = JSON.parse(message.attachments);
      if (!attachment.url) return;

      const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      
      await channel.send({
        content: message.content ? `${message.authorName}: ${message.content}` : `${message.authorName}:`,
        files: [{
          attachment: buffer,
          name: attachment.name || 'media'
        }]
      });
    } catch (error) {
      this.logger.error('Failed to handle media:', error);
    }
  }

  private async handleMessage(msg: Message) {
    if (msg.author.bot) return;

    const channel = await this.prisma.channel.findUnique({
      where: {
        platform_channelId: {
          platform: 'discord',
          channelId: msg.channelId,
        },
      },
    });

    if (!channel) return;

    try {
      let content = msg.content;
      let replyReference = '';

      if (msg.reference?.messageId) {
        const repliedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
        if (repliedMessage) {
          replyReference = `↪️ Replying to ${repliedMessage.author.username}:\n"${repliedMessage.content}"\n\n`;
        }
      }

      await this.prisma.message.create({
        data: {
          platform: 'discord',
          platformId: msg.id,
          content: msg.content,
          channelId: channel.id,
          authorId: msg.author.id,
          authorName: msg.author.username,
          threadId: msg.thread?.id || null,
          replyToId: msg.reference?.messageId || null,
          attachments: msg.attachments.size > 0 ? 
            JSON.stringify(Array.from(msg.attachments.values())) : null,
        },
      });

      this.broker.publish({
        content: replyReference + content,
        platform: 'discord',
        channelId: msg.channelId,
        authorName: msg.author.username,
        attachments: msg.attachments.size > 0 ? 
          JSON.stringify(Array.from(msg.attachments.values())) : null,
        replyToId: msg.reference?.messageId
      });

      if (msg.stickers && msg.stickers.size > 0) {
        for (const sticker of msg.stickers.values()) {
          this.broker.publish({
            content: sticker.name,
            platform: 'discord',
            channelId: msg.channelId,
            authorName: msg.author.username,
            attachments: JSON.stringify({
              url: sticker.url,
              contentType: sticker.format === 2 ? 'image/gif' : 'image/png',
              isSticker: true,
              isAnimated: sticker.format === 2
            })
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to process message:', error);
    }
  }
}
