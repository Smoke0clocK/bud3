import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface BridgeMessage {
  content: string;
  platform: 'discord' | 'telegram';
  channelId: string;
  authorName: string;
  authorAvatar?: string;  // Make avatar optional
  attachments?: string | null;
  replyToId?: string | null;
  replyData?: string | null;
}

@Injectable()
export class MessageBrokerService {
  private logger = new Logger('MessageBroker');
  private messageSubject = new Subject<BridgeMessage>();

  publish(message: BridgeMessage) {
    this.logger.debug(`Publishing message from ${message.platform}`);
    this.messageSubject.next(message);
  }

  subscribe(callback: (message: BridgeMessage) => void) {
    return this.messageSubject.subscribe(callback);
  }
}
