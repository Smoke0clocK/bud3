'use client';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { PrismaService } from '../services/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Message } from 'telegraf/typings/core/types/typegram';
import { MessageBrokerService } from '../services/message-broker.service';
import axios from 'axios';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf;
  private logger = new Logger('TelegramService');
  private messageCache = new Map<string, { authorName: string, content: string }>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private broker: MessageBrokerService,
  ) {
    this.bot = new Telegraf(this.config.get('TELEGRAM_TOKEN'));
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing Telegram bot...');
      
      // Handle all message types
      this.bot.on(['text', 'sticker', 'animation', 'photo', 'video', 'document'], (ctx) => this.handleMessage(ctx));
      
      // Handle Discord messages
      this.broker.subscribe(async (message) => {
        if (message.platform === 'discord') {
          await this.handleDiscordMessage(message);
        }
      });

      await this.bot.launch();
      this.logger.log('Telegram bot is online!');

      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      this.logger.error('Failed to start Telegram bot:', error);
    }
  }

  private async handleDiscordMessage(message: any) {
    try {
      const pair = await this.getChannelPair(message);
      if (!pair) return;

      const options: any = {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };

      // Handle reply data
      if (message.replyData) {
        const replyInfo = JSON.parse(message.replyData);
        const repliedMessage = await this.prisma.message.findFirst({
          where: {
            platform: 'telegram',
            channelId: pair.telegramChannel.id
          }
        });

        if (repliedMessage) {
          options.reply_to_message_id = parseInt(repliedMessage.platformId);
        }
      }

      // Create caption/message with author's name
      let content = message.content;
      if (!content.startsWith(message.authorName)) {
        content = `${message.authorName}: ${content}`;
      }

      // Handle avatar if provided
      if (message.authorAvatar) {
        try {
          const response = await axios.get(message.authorAvatar, { responseType: 'arraybuffer' });
          // Store avatar for potential future use
          this.messageCache.set(message.authorName, {
            authorName: message.authorName,
            content: message.content
          });
        } catch (error) {
          this.logger.error('Failed to fetch avatar:', error);
        }
      }

      // Handle media attachments
      if (message.attachments) {
        const attachments = JSON.parse(message.attachments);
        await this.handleDiscordMedia(
          pair.telegramChannel.channelId,
          content,
          attachments,
          options
        );
      } else {
        // Send text message
        await this.bot.telegram.sendMessage(
          pair.telegramChannel.channelId,
          content,
          options
        );
      }
    } catch (error) {
      this.logger.error('Failed to handle Discord message:', error);
    }
  }

  private async handleDiscordMedia(chatId: string, content: string, attachments: any, options: any) {
    try {
      const mediaItems = Array.isArray(attachments) ? attachments : [attachments];

      for (const item of mediaItems) {
        const response = await axios.get(item.url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const mediaOptions = { ...options, caption: content };

        if (item.isSticker) {
          if (item.isAnimated) {
            await this.bot.telegram.sendAnimation(chatId, { source: buffer }, mediaOptions);
          } else {
            await this.bot.telegram.sendSticker(chatId, { source: buffer });
            // Send caption separately since stickers can't have captions
            await this.bot.telegram.sendMessage(chatId, content, options);
          }
        } else if (item.contentType.startsWith('image/gif')) {
          await this.bot.telegram.sendAnimation(chatId, { source: buffer }, mediaOptions);
        } else if (item.contentType.startsWith('image/')) {
          await this.bot.telegram.sendPhoto(chatId, { source: buffer }, mediaOptions);
        } else if (item.contentType.startsWith('video/')) {
          await this.bot.telegram.sendVideo(chatId, { source: buffer }, mediaOptions);
        } else {
          await this.bot.telegram.sendDocument(
            chatId,
            { source: buffer, filename: item.name || 'file' },
            mediaOptions
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle Discord media:', error);
    }
  }

  private async handleMessage(ctx: Context) {
    try {
      if (!ctx.message) return;

      let content = '';
      let attachments = null;

      // Handle different message types
      if ('text' in ctx.message) {
        content = ctx.message.text;
      } else if ('sticker' in ctx.message) {
        const fileUrl = await this.bot.telegram.getFileLink(ctx.message.sticker.file_id);
        content = ctx.message.sticker.emoji || '[Sticker]';
        attachments = JSON.stringify({
          url: fileUrl.href,
          contentType: 'image/webp',
          isSticker: true,
          isAnimated: ctx.message.sticker.is_animated
        });
      } else if ('animation' in ctx.message) {
        const fileUrl = await this.bot.telegram.getFileLink(ctx.message.animation.file_id);
        content = ctx.message.caption || '[GIF]';
        attachments = JSON.stringify({
          url: fileUrl.href,
          contentType: 'image/gif',
          name: ctx.message.animation.file_name
        });
      } else if ('photo' in ctx.message) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileUrl = await this.bot.telegram.getFileLink(photo.file_id);
        content = ctx.message.caption || '';
        attachments = JSON.stringify({
          url: fileUrl.href,
          contentType: 'image/jpeg'
        });
      } else if ('video' in ctx.message) {
        const fileUrl = await this.bot.telegram.getFileLink(ctx.message.video.file_id);
        content = ctx.message.caption || '';
        attachments = JSON.stringify({
          url: fileUrl.href,
          contentType: 'video/mp4',
          name: ctx.message.video.file_name
        });
      }

      const channel = await this.prisma.channel.findUnique({
        where: {
          platform_channelId: {
            platform: 'telegram',
            channelId: ctx.chat.id.toString(),
          },
        },
      });

      if (!channel) return;

      // Store message
      await this.prisma.message.create({
        data: {
          platform: 'telegram',
          platformId: ctx.message.message_id.toString(),
          content,
          channelId: channel.id,
          authorId: ctx.from.id.toString(),
          authorName: ctx.from.username || ctx.from.first_name || 'Unknown',
          threadId: null,
          replyToId: ('reply_to_message' in ctx.message) ? 
            ctx.message.reply_to_message?.message_id?.toString() : null,
          attachments
        }
      });

      // Prepare reply data if message is a reply
      let replyData = null;
      if ('reply_to_message' in ctx.message && ctx.message.reply_to_message) {
        replyData = {
          authorName: ctx.message.reply_to_message.from.username || ctx.message.reply_to_message.from.first_name,
          content: 'text' in ctx.message.reply_to_message ? ctx.message.reply_to_message.text : '[Media Message]',
          messageId: ctx.message.reply_to_message.message_id
        };
      }

      // Publish to broker
      this.broker.publish({
        content,
        platform: 'telegram',
        channelId: ctx.chat.id.toString(),
        authorName: ctx.from.username || ctx.from.first_name || 'Unknown',
        attachments,
        replyData: replyData ? JSON.stringify(replyData) : null
      });
    } catch (error) {
      this.logger.error('Error handling Telegram message:', error);
    }
  }

  private async getChannelPair(message: any) {
    const discordChannel = await this.prisma.channel.findFirst({
      where: { platform: 'discord', channelId: message.channelId }
    });
    
    if (!discordChannel) return null;

    const telegramChannel = await this.prisma.channel.findFirst({
      where: { platform: 'telegram', bridgeId: discordChannel.bridgeId }
    });

    return telegramChannel ? { discordChannel, telegramChannel } : null;
  }
}
