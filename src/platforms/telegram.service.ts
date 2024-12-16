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

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private broker: MessageBrokerService,
  ) {
    // Enhanced initialization with better error handling
    this.bot = new Telegraf(this.config.get('TELEGRAM_TOKEN'), {
      handlerTimeout: 90000,
      telegram: {
        timeout: 30000,
        webhookReply: false,
        apiRoot: 'https://api.telegram.org'
      }
    });
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing Telegram bot...');
      
      // Message handlers with detailed logging
      this.bot.on('text', (ctx) => {
        this.logger.log('Received text message');
        return this.handleMessage(ctx);
      });
      
      this.bot.on('sticker', (ctx) => {
        this.logger.log('Received sticker');
        return this.handleMessage(ctx);
      });
      
      this.bot.on(['photo', 'video', 'animation'], (ctx) => {
        this.logger.log('Received media');
        return this.handleMessage(ctx);
      });

      // Handle message deletions
      this.bot.on('message_delete', async (ctx) => {
        await this.handleMessageDelete(ctx);
      });

      // Handle message edits
      this.bot.on('edited_message', async (ctx) => {
        await this.handleMessageEdit(ctx);
      });

      this.broker.subscribe(async (message) => {
        if (message.platform === 'discord') {
          await this.handleDiscordMessage(message);
        }
      });

      await this.bot.launch();
      this.logger.log('🤖 Telegram bot is online!');

      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      this.logger.error('Failed to initialize Telegram bot:', error);
      // Attempt recovery
      setTimeout(() => this.onModuleInit(), 5000);
    }
  }

  private async handleMessage(ctx: Context) {
    try {
      if (!ctx.message) {
        this.logger.warn('No message in context');
        return;
      }

      let content = '';
      let attachments = null;
      let originalMessageId = null;

      // Extract message content based on type
      if ('text' in ctx.message) {
        content = ctx.message.text;
      } else if ('sticker' in ctx.message) {
        try {
          const fileUrl = await this.bot.telegram.getFileLink(ctx.message.sticker.file_id);
          content = ctx.message.sticker.emoji || '[Sticker]';
          attachments = JSON.stringify({
            url: fileUrl.href,
            contentType: 'image/webp',
            isSticker: true,
            isAnimated: ctx.message.sticker.is_animated
          });
        } catch (error) {
          this.logger.error('Failed to process sticker:', error);
        }
      } else if ('photo' in ctx.message) {
        try {
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          const fileUrl = await this.bot.telegram.getFileLink(photo.file_id);
          content = ctx.message.caption || '';
          attachments = JSON.stringify({
            url: fileUrl.href,
            contentType: 'image/jpeg'
          });
        } catch (error) {
          this.logger.error('Failed to process photo:', error);
        }
      }

      // Handle reply
      let replyData = null;
      if ('reply_to_message' in ctx.message && ctx.message.reply_to_message) {
        const repliedMsg = ctx.message.reply_to_message;
        originalMessageId = repliedMsg.message_id;

        const repliedDbMessage = await this.prisma.message.findFirst({
          where: {
            platform: 'telegram',
            platformId: originalMessageId.toString()
          }
        });

        if (repliedDbMessage) {
          replyData = {
            messageId: repliedDbMessage.platformId,
            authorName: repliedDbMessage.authorName,
            content: repliedDbMessage.content
          };
        }
      }

      const channel = await this.prisma.channel.findUnique({
        where: {
          platform_channelId: {
            platform: 'telegram',
            channelId: ctx.chat.id.toString(),
          },
        },
      });

      if (!channel) {
        this.logger.warn(`No channel found for chat ID: ${ctx.chat.id}`);
        return;
      }

      const authorName = ctx.from.username || ctx.from.first_name || 'Unknown';

      // Store message
      const stored = await this.prisma.message.create({
        data: {
          platform: 'telegram',
          platformId: ctx.message.message_id.toString(),
          content,
          channelId: channel.id,
          authorId: ctx.from.id.toString(),
          authorName,
          threadId: null,
          replyToId: originalMessageId?.toString(),
          replyData: replyData ? JSON.stringify(replyData) : null,
          attachments
        }
      });

      // Publish to broker
      this.broker.publish({
        content,
        platform: 'telegram',
        channelId: ctx.chat.id.toString(),
        authorName,
        attachments,
        replyData: replyData ? JSON.stringify(replyData) : null
      });
    } catch (error) {
      this.logger.error('Error handling Telegram message:', error);
    }
  }

  private async handleMessageDelete(ctx: Context) {
    try {
      const messageId = ctx.message.message_id.toString();
      
      // Find and delete from database
      const deletedMessage = await this.prisma.message.deleteMany({
        where: {
          platform: 'telegram',
          platformId: messageId
        }
      });

      if (deletedMessage.count > 0) {
        // Notify broker about deletion
        this.broker.publish({
          platform: 'telegram',
          action: 'delete',
          messageId: messageId
        });
      }
    } catch (error) {
      this.logger.error('Failed to handle message deletion:', error);
    }
  }

  private async handleMessageEdit(ctx: Context) {
    if (!ctx.editedMessage || !('text' in ctx.editedMessage)) return;

    try {
      const messageId = ctx.editedMessage.message_id.toString();
      const newContent = ctx.editedMessage.text;

      // Update in database
      await this.prisma.message.updateMany({
        where: {
          platform: 'telegram',
          platformId: messageId
        },
        data: {
          content: newContent,
          editedAt: new Date()
        }
      });

      // Notify broker about edit
      this.broker.publish({
        platform: 'telegram',
        action: 'edit',
        messageId: messageId,
        content: newContent
      });
    } catch (error) {
      this.logger.error('Failed to handle message edit:', error);
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
        if (replyInfo.messageId) {
          const repliedMessage = await this.prisma.message.findFirst({
            where: {
              platform: 'telegram',
              channelId: pair.telegramChannel.id,
              platformId: replyInfo.messageId
            }
          });

          if (repliedMessage) {
            options.reply_to_message_id = parseInt(repliedMessage.platformId);
          }
        }
      }

      // Format message to look native to Telegram
      let content = message.content;
      if (message.authorName && !content.startsWith(message.authorName)) {
        content = `${message.authorName}: ${content}`;
      }

      if (message.attachments) {
        await this.handleDiscordMedia(
          pair.telegramChannel.channelId,
          content,
          message.attachments,
          options
        );
      } else {
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

  private async handleDiscordMedia(chatId: string, content: string, attachments: string, options: any) {
    try {
      const mediaData = JSON.parse(attachments);
      const mediaItems = Array.isArray(mediaData) ? mediaData : [mediaData];

      for (const item of mediaItems) {
        if (!item.url || typeof item.url !== 'string') {
          this.logger.error('Invalid media URL in item:', item);
          continue;
        }

        try {
          const response = await axios.get(item.url, { 
            responseType: 'arraybuffer',
            timeout: 10000
          });
          const buffer = Buffer.from(response.data);

          if (item.isSticker) {
            await this.bot.telegram.sendSticker(chatId, { source: buffer });
            // Send caption separately since stickers can't have captions
            if (content) {
              await this.bot.telegram.sendMessage(chatId, content, options);
            }
          } else if (item.contentType?.includes('gif')) {
            await this.bot.telegram.sendAnimation(chatId, { source: buffer }, { ...options, caption: content });
          } else if (item.contentType?.includes('video')) {
            await this.bot.telegram.sendVideo(chatId, { source: buffer }, { ...options, caption: content });
          } else if (item.contentType?.includes('image')) {
            await this.bot.telegram.sendPhoto(chatId, { source: buffer }, { ...options, caption: content });
          } else {
            await this.bot.telegram.sendDocument(
              chatId,
              { source: buffer, filename: item.name || 'file' },
              { ...options, caption: content }
            );
          }
        } catch (error) {
          this.logger.error(`Failed to handle media item: ${item.url}`, error);
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle Discord media:', error);
      // Try to send text-only message as fallback
      try {
        await this.bot.telegram.sendMessage(chatId, content, options);
      } catch (sendError) {
        this.logger.error('Failed to send fallback message:', sendError);
      }
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
