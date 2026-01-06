import { cn } from '@/lib/utils';
import { ChatMessage } from '@/contexts/ChatContext';
import { format } from 'date-fns';
import { Bot, User } from 'lucide-react';

interface ChatBubbleProps {
  message: ChatMessage;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center my-4 chat-bubble-enter">
        <div className="px-4 py-2 rounded-full bg-muted text-muted-foreground text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex gap-3 max-w-[90%] chat-bubble-enter',
        isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary' : 'bg-accent'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-primary-foreground" />
        ) : (
          <Bot className="w-4 h-4 text-accent-foreground" />
        )}
      </div>

      {/* Message content */}
      <div
        className={cn(
          'px-4 py-3 rounded-2xl shadow-chat',
          isUser
            ? 'bg-chat-bubble-user text-chat-bubble-user-text rounded-br-md'
            : 'bg-chat-bubble-bot text-chat-bubble-bot-text rounded-bl-md'
        )}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        <span
          className={cn(
            'text-[10px] mt-1 block',
            isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'
          )}
        >
          {format(message.timestamp, 'h:mm a')}
        </span>
      </div>
    </div>
  );
}
