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
      const displayName = msg.member?.displayName || msg.author.username;
      const avatarUrl = msg.author.displayAvatarURL({ extension: 'png', size: 128 });
      let messageContent = msg.content;
      let replyData = null;

      // Handle reply chains
      if (msg.reference?.messageId) {
        const repliedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
        if (repliedMessage) {
          const repliedAuthor = repliedMessage.member?.displayName || repliedMessage.author.username;
          replyData = {
            authorName: repliedAuthor,
            content: repliedMessage.content,
            messageId: repliedMessage.id
          };
        }
      }

      // Store message
      const stored = await this.prisma.message.create({
        data: {
          platform: 'discord',
          platformId: msg.id,
          content: messageContent,
          channelId: channel.id,
          authorId: msg.author.id,
          authorName: displayName,
          authorAvatar: avatarUrl,
          threadId: msg.thread?.id || null,
          replyToId: msg.reference?.messageId || null,
          attachments: msg.attachments.size > 0 ? 
            JSON.stringify(Array.from(msg.attachments.values())) : null
        },
      });

      // Handle media attachments
      const mediaAttachments = [];
      if (msg.attachments.size > 0) {
        for (const [_, attachment] of msg.attachments) {
          mediaAttachments.push({
            url: attachment.url,
            contentType: attachment.contentType || this.getContentType(attachment.name),
            name: attachment.name,
            width: attachment.width,
            height: attachment.height
          });
        }
      }

      // Handle stickers
      if (msg.stickers.size > 0) {
        for (const sticker of msg.stickers.values()) {
          mediaAttachments.push({
            url: sticker.url,
            contentType: `image/${sticker.format === 2 ? 'gif' : 'png'}`,
            isSticker: true,
            isAnimated: sticker.format === 2,
            name: sticker.name
          });
        }
      }

      // Publish message
      this.broker.publish({
        content: messageContent,
        platform: 'discord',
        channelId: msg.channelId,
        authorName: displayName,
        authorAvatar: avatarUrl,
        attachments: mediaAttachments.length > 0 ? JSON.stringify(mediaAttachments) : null,
        replyData: replyData ? JSON.stringify(replyData) : null
      });
    } catch (error) {
      this.logger.error('Failed to process message:', error);
    }
  }

  private async handleTelegramMessage(message: any) {
    try {
      const pair = await this.getChannelPair(message);
      if (!pair) return;

      const channel = await this.client.channels.fetch(pair.discordChannel.channelId);
      if (!(channel instanceof TextChannel)) return;

      const content = `${message.authorName}: ${message.content}`;

      if (message.attachments) {
        const attachments = JSON.parse(message.attachments);
        await this.sendMediaToDiscord(channel, content, attachments);
      } else {
        await channel.send(content);
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }

  private async sendMediaToDiscord(channel: TextChannel, content: string, attachments: any) {
    try {
      for (const attachment of Array.isArray(attachments) ? attachments : [attachments]) {
        const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        await channel.send({
          content,
          files: [{
            attachment: buffer,
            name: attachment.name || `file.${this.getExtensionFromType(attachment.contentType)}`
          }]
        });
      }
    } catch (error) {
      this.logger.error('Failed to send media:', error);
    }
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      mov: 'video/quicktime'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private getExtensionFromType(contentType: string): string {
    const types = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov'
    };
    return types[contentType] || 'bin';
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
}
