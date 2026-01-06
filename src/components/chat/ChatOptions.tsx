import { useState } from 'react';
import { ChatOption } from '@/contexts/ChatContext';
import { ChatChip } from './ChatChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Send } from 'lucide-react';

interface ChatOptionsProps {
  options: ChatOption[];
  multiSelect?: boolean;
  showTextInput?: boolean;
  textInputPlaceholder?: string;
  showAddAnother?: boolean;
  onSelect: (selectedIds: string[]) => void;
  onTextSubmit?: (text: string) => void;
  onAddAnother?: () => void;
}

export function ChatOptions({
  options,
  multiSelect = false,
  showTextInput = false,
  textInputPlaceholder,
  showAddAnother = false,
  onSelect,
  onTextSubmit,
  onAddAnother,
}: ChatOptionsProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [textValue, setTextValue] = useState('');

  const handleChipClick = (option: ChatOption) => {
    if (option.disabled) return;

    if (multiSelect) {
      setSelectedIds((prev) =>
        prev.includes(option.id)
          ? prev.filter((id) => id !== option.id)
          : [...prev, option.id]
      );
    } else {
      onSelect([option.id]);
    }
  };

  const handleConfirmMultiSelect = () => {
    if (selectedIds.length > 0) {
      onSelect(selectedIds);
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textValue.trim() && onTextSubmit) {
      onTextSubmit(textValue.trim());
      setTextValue('');
    }
  };

  return (
    <div className="space-y-3 chat-bubble-enter">
      {/* Chips */}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <ChatChip
            key={option.id}
            label={option.label}
            description={option.description}
            selected={multiSelect ? selectedIds.includes(option.id) : option.selected}
            disabled={option.disabled}
            multiSelect={multiSelect}
            onClick={() => handleChipClick(option)}
          />
        ))}
      </div>

      {/* Multi-select confirm button */}
      {multiSelect && selectedIds.length > 0 && (
        <Button
          onClick={handleConfirmMultiSelect}
          className="w-full mt-2"
          size="lg"
        >
          Continue with {selectedIds.length} selected
        </Button>
      )}

      {/* Skip option for multi-select */}
      {multiSelect && selectedIds.length === 0 && (
        <Button
          variant="ghost"
          onClick={() => onSelect([])}
          className="w-full mt-2 text-muted-foreground"
        >
          Skip (no additional staff)
        </Button>
      )}

      {/* Text input */}
      {showTextInput && (
        <form onSubmit={handleTextSubmit} className="flex gap-2 mt-3">
          <Input
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={textInputPlaceholder || 'Type here...'}
            className="flex-1"
          />
          <Button type="submit" size="icon" disabled={!textValue.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      )}

      {/* Add another button */}
      {showAddAnother && (
        <Button
          variant="outline"
          onClick={onAddAnother}
          className="w-full mt-2"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add another attendee
        </Button>
      )}
    </div>
  );
}
