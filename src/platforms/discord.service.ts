'use client';

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Client, GatewayIntentBits, Message, TextChannel, MessageReaction } from 'discord.js';
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
        GatewayIntentBits.GuildMessageReactions,
      ],
    });
  }

  async onModuleInit() {
    try {
      // Message handling
      this.client.on('messageCreate', (msg) => this.handleMessage(msg));
      
      // Message deletion
      this.client.on('messageDelete', (msg) => this.handleMessageDelete(msg));
      
      // Message editing
      this.client.on('messageUpdate', (oldMsg, newMsg) => this.handleMessageEdit(oldMsg, newMsg));

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
    if (msg.author.bot && !msg.webhookId) return;

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

      // Handle replies
      if (msg.reference?.messageId) {
        try {
          const repliedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
          if (repliedMessage) {
            const repliedAuthor = repliedMessage.member?.displayName || repliedMessage.author.username;
            replyData = {
              messageId: repliedMessage.id,
              authorName: repliedAuthor,
              content: repliedMessage.content
            };
          }
        } catch (error) {
          this.logger.error('Failed to fetch reply message:', error);
        }
      }

      // Store message in database
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
          replyData: replyData ? JSON.stringify(replyData) : null,
          attachments: msg.attachments.size > 0 ? 
            JSON.stringify(Array.from(msg.attachments.values())) : null
        },
      });

      // Handle attachments
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

      // Publish to broker
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

  private async handleMessageDelete(msg: Message) {
    try {
      // Find the message in our database
      const storedMessage = await this.prisma.message.findFirst({
        where: {
          platform: 'discord',
          platformId: msg.id
        }
      });

      if (storedMessage) {
        // Delete from database
        await this.prisma.message.delete({
          where: {
            id: storedMessage.id
          }
        });

        // Notify broker about deletion
        this.broker.publish({
          platform: 'discord',
          channelId: msg.channelId,
          action: 'delete',
          messageId: msg.id
        });
      }
    } catch (error) {
      this.logger.error('Failed to handle message deletion:', error);
    }
  }

  private async handleMessageEdit(oldMsg: Message, newMsg: Message) {
    try {
      // Update in database
      await this.prisma.message.updateMany({
        where: {
          platform: 'discord',
          platformId: newMsg.id
        },
        data: {
          content: newMsg.content,
          editedAt: new Date()
        }
      });

      // Notify broker about edit
      this.broker.publish({
        platform: 'discord',
        channelId: newMsg.channelId,
        action: 'edit',
        messageId: newMsg.id,
        content: newMsg.content
      });
    } catch (error) {
      this.logger.error('Failed to handle message edit:', error);
    }
  }

  private async handleTelegramMessage(message: any) {
    try {
      const pair = await this.getChannelPair(message);
      if (!pair) return;

      const channel = await this.client.channels.fetch(pair.discordChannel.channelId);
      if (!(channel instanceof TextChannel)) return;

      // Format message to look native to Discord
      const content = `**${message.authorName}** ${message.content}`;

      if (message.attachments) {
        await this.handleIncomingMedia(channel, content, message);
      } else {
        const options: any = {};
        
        // Handle replies
        if (message.replyData) {
          const replyInfo = JSON.parse(message.replyData);
          const repliedMessage = await this.prisma.message.findFirst({
            where: {
              platform: 'discord',
              channelId: channel.id,
              platformId: replyInfo.messageId
            }
          });

          if (repliedMessage) {
            options.reply = { messageReference: repliedMessage.platformId };
          }
        }

        await channel.send({ content, ...options });
      }
    } catch (error) {
      this.logger.error('Failed to send message:', error);
    }
  }

  private async handleIncomingMedia(channel: TextChannel, content: string, message: any) {
    try {
      const attachments = JSON.parse(message.attachments);
      const attachmentArray = Array.isArray(attachments) ? attachments : [attachments];

      for (const attachment of attachmentArray) {
        if (!attachment.url) continue;

        try {
          const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(response.data);

          await channel.send({
            content,
            files: [{
              attachment: buffer,
              name: attachment.name || 'media'
            }]
          });
        } catch (error) {
          this.logger.error('Failed to handle media attachment:', error);
          // Send text-only message as fallback
          await channel.send(content);
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle media message:', error);
      // Send text-only message as fallback
      await channel.send(content);
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
