import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface ChatChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  description?: string;
  onClick?: () => void;
  multiSelect?: boolean;
}

export function ChatChip({
  label,
  selected = false,
  disabled = false,
  description,
  onClick,
  multiSelect = false,
}: ChatChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 chip-hover',
        'border border-transparent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        selected
          ? 'bg-chip-selected-bg text-chip-selected-text shadow-elevated'
          : 'bg-chip-bg text-chip-text hover:bg-chip-bg-hover',
        disabled && 'opacity-50 cursor-not-allowed hover:transform-none',
        description && 'text-left'
      )}
    >
      <div className="flex items-center gap-2">
        {multiSelect && (
          <div
            className={cn(
              'w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
              selected
                ? 'bg-chip-selected-text border-chip-selected-text'
                : 'border-current'
            )}
          >
            {selected && <Check className="w-3 h-3 text-chip-selected-bg" />}
          </div>
        )}
        <div>
          <span className="block">{label}</span>
          {description && (
            <span
              className={cn(
                'block text-xs mt-0.5',
                selected ? 'text-chip-selected-text/70' : 'text-muted-foreground'
              )}
            >
              {description}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
