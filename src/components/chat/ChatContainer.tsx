import { useEffect, useRef } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { ChatBubble } from './ChatBubble';
import { TypingIndicator } from './TypingIndicator';
import { ChatOptions } from './ChatOptions';
import { useChatFlow } from '@/hooks/useChatFlow';

export function ChatContainer() {
  const { messages, isTyping } = useChat();
  const { handleOptionSelect, handleTextInput } = useChatFlow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  return (
    <div className="flex flex-col h-full bg-chat-bg">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 chat-scroll">
        {messages.map((message) => (
          <ChatBubble key={message.id} message={message} />
        ))}
        {isTyping && <TypingIndicator />}
        
        {/* Options for last bot message */}
        {lastMessage?.type === 'bot' && lastMessage.options && !isTyping && (
          <div className="pl-11">
            <ChatOptions
              options={lastMessage.options}
              multiSelect={lastMessage.multiSelect}
              showTextInput={lastMessage.showTextInput}
              textInputPlaceholder={lastMessage.textInputPlaceholder}
              showAddAnother={lastMessage.showAddAnother}
              onSelect={handleOptionSelect}
              onTextSubmit={handleTextInput}
            />
          </div>
        )}
      </div>
    </div>
  );
}
