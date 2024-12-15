'use client';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Context } from 'telegraf';
import { PrismaService } from '../services/prisma.service';
import { ConfigService } from '@nestjs/config';
import { Message, Sticker } from 'telegraf/typings/core/types/typegram';
import { MessageBrokerService } from '../services/message-broker.service';
import axios from 'axios';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf;
  private logger = new Logger('TelegramService');
  private userProfiles: Map<string, { firstName: string, username: string, avatar?: string }> = new Map();

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
      
      // Track user profile updates
      this.bot.on(['new_chat_members', 'left_chat_member'], (ctx) => this.updateUserProfiles(ctx));
      
      this.broker.subscribe(async (message) => {
        if (message.platform === 'discord') {
          const pair = await this.getChannelPair(message);
          if (!pair) return;

          try {
            const options: any = {
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true }
            };

            // Handle reply chains
            if (message.replyToId) {
              const repliedMessage = await this.prisma.message.findFirst({
                where: {
                  platformId: message.replyToId,
                  platform: 'telegram'
                }
              });
              if (repliedMessage) {
                options.reply_to_message_id = parseInt(repliedMessage.platformId);
                options.allow_sending_without_reply = true;
              }
            }

            if (message.attachments) {
              await this.handleDiscordMedia(
                pair.telegramChannel.channelId,
                message.authorName,
                message.content,
                JSON.parse(message.attachments),
                options
              );
            } else if (message.content?.trim()) {
              // Format the sender name properly with HTML
              const formattedContent = message.content.replace(/^[^:]+:/, '').trim();
              await this.bot.telegram.sendMessage(
                pair.telegramChannel.channelId,
                `<b>${message.authorName}</b>${formattedContent ? `: ${formattedContent}` : ''}`,
                options
              );
            }
          } catch (error) {
            this.logger.error(`Failed to send message: ${error.message}`);
          }
        }
      });

      await this.bot.launch();
      this.logger.log('🤖 Telegram bot is online!');

      process.once('SIGINT', () => this.bot.stop('SIGINT'));
      process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    } catch (error) {
      this.logger.error('Failed to start Telegram bot:', error);
      throw error;
    }
  }

  private async updateUserProfiles(ctx: Context) {
    if ('new_chat_members' in ctx.message) {
      for (const member of ctx.message.new_chat_members) {
        this.userProfiles.set(member.id.toString(), {
          firstName: member.first_name,
          username: member.username || member.first_name,
        });
      }
    } else if ('left_chat_member' in ctx.message) {
      const member = ctx.message.left_chat_member;
      this.userProfiles.set(member.id.toString(), {
        firstName: member.first_name,
        username: member.username || member.first_name,
      });
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

  private async handleDiscordMedia(chatId: string, authorName: string, caption: string | undefined, files: any[], options: any) {
    try {
      for (const file of files) {
        const response = await axios.get(file.url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const messageText = caption ? 
          `<b>${authorName}</b>: ${caption}` : 
          `<b>${authorName}</b>`;

        if (file.isSticker) {
          if (file.isAnimated) {
            // Handle animated stickers by converting to animated WebP
            await this.bot.telegram.sendAnimation(chatId, { source: buffer }, { ...options, caption: messageText });
          } else {
            await this.bot.telegram.sendSticker(chatId, { source: buffer }, options);
          }
        } else if (file.contentType?.startsWith('image/gif') || file.url.includes('.gif')) {
          await this.bot.telegram.sendAnimation(chatId, { source: buffer }, { ...options, caption: messageText });
        } else if (file.contentType?.startsWith('image/')) {
          await this.bot.telegram.sendPhoto(chatId, { source: buffer }, { ...options, caption: messageText });
        } else if (file.contentType?.startsWith('video/')) {
          await this.bot.telegram.sendVideo(chatId, { source: buffer }, { ...options, caption: messageText });
        } else {
          await this.bot.telegram.sendDocument(chatId, 
            { source: buffer, filename: file.name || 'file' },
            { ...options, caption: messageText }
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
      let replyToMessage = null;

      // Get user profile info
      const userId = ctx.from.id.toString();
      if (!this.userProfiles.has(userId)) {
        this.userProfiles.set(userId, {
          firstName: ctx.from.first_name,
          username: ctx.from.username || ctx.from.first_name,
        });
      }

      // Handle reply chains
      if ('reply_to_message' in ctx.message && ctx.message.reply_to_message) {
        replyToMessage = ctx.message.reply_to_message;
      }

      const handleMediaFile = async (fileId: string, type: string, fileName?: string) => {
        const fileUrl = await this.bot.telegram.getFileLink(fileId);
        return JSON.stringify({
          url: fileUrl.href,
          contentType: type,
          name: fileName
        });
      };

      if ('text' in ctx.message) {
        content = ctx.message.text;
      } else if ('sticker' in ctx.message) {
        const sticker = ctx.message.sticker as Sticker;
        const fileUrl = await this.bot.telegram.getFileLink(sticker.file_id);
        content = sticker.emoji || '[Sticker]';
        attachments = JSON.stringify({
          url: fileUrl.href,
          contentType: sticker.is_animated ? 'image/webp' : 'image/webp',
          isSticker: true,
          isAnimated: sticker.is_animated,
          emoji: sticker.emoji
        });
      } else if ('animation' in ctx.message) {
        attachments = await handleMediaFile(
          ctx.message.animation.file_id,
          'image/gif',
          ctx.message.animation.file_name
        );
        content = ctx.message.caption || '[GIF]';
      } else if ('photo' in ctx.message) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        attachments = await handleMediaFile(photo.file_id, 'image/jpeg');
        content = ctx.message.caption || '';
      } else if ('video' in ctx.message) {
        attachments = await handleMediaFile(
          ctx.message.video.file_id,
          'video/mp4',
          ctx.message.video.file_name
        );
        content = ctx.message.caption || '';
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
      const authorName = ctx.from.username || ctx.from.first_name;
      await this.prisma.message.create({
        data: {
          platform: 'telegram',
          platformId: ctx.message.message_id.toString(),
          content,
          channelId: channel.id,
          authorId: ctx.from.id.toString(),
          authorName,
          threadId: null,
          replyToId: replyToMessage ? replyToMessage.message_id.toString() : null,
          attachments
        }
      });

      // Include reply context in the message
      let fullContent = content;
      if (replyToMessage) {
        const repliedContent = 'text' in replyToMessage ? replyToMessage.text :
          'caption' in replyToMessage ? replyToMessage.caption : '[media message]';
        const repliedAuthor = replyToMessage.from.username || replyToMessage.from.first_name;
        fullContent = `<b>${authorName}</b>\n↪️ Replying to ${repliedAuthor}:\n"${repliedContent}"\n\n${content}`;
      } else {
        fullContent = `<b>${authorName}</b>: ${content}`;
      }

      // Publish to broker
      this.broker.publish({
        content: fullContent,
        platform: 'telegram',
        channelId: ctx.chat.id.toString(),
        authorName,
        attachments,
        replyToId: replyToMessage ? replyToMessage.message_id.toString() : null
      });
    } catch (error) {
      this.logger.error('Error handling Telegram message:', error);
    }
  }
}
