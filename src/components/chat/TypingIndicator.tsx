import { Bot } from 'lucide-react';

export function TypingIndicator() {
  return (
    <div className="flex gap-3 max-w-[90%] mr-auto chat-bubble-enter">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
        <Bot className="w-4 h-4 text-accent-foreground" />
      </div>
      <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-chat-bubble-bot shadow-chat">
        <div className="flex gap-1.5 py-1">
          <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
          <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
          <div className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
        </div>
      </div>
    </div>
  );
}
