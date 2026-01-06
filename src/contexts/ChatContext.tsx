import React, { createContext, useContext, useState, useCallback } from 'react';
import { ExternalAttendee, MeetingPreferences, LocationMode, InPersonLocation, TimeOfDayPreference } from '@/lib/supabase';

export type ChatStep = 
  | 'start'
  | 'meeting_type'
  | 'duration'
  | 'external_attendees'
  | 'host_attorney'
  | 'support_staff'
  | 'location_mode'
  | 'in_person_location'
  | 'preferences_days'
  | 'preferences_time'
  | 'preferences_timezone'
  | 'suggest_times'
  | 'confirm_booking'
  | 'booking_complete'
  | 'override_mode';

export interface ChatMessage {
  id: string;
  type: 'bot' | 'user' | 'system';
  content: string;
  timestamp: Date;
  options?: ChatOption[];
  multiSelect?: boolean;
  showTextInput?: boolean;
  textInputPlaceholder?: string;
  showAddAnother?: boolean;
}

export interface ChatOption {
  id: string;
  label: string;
  value: string;
  selected?: boolean;
  disabled?: boolean;
  description?: string;
}

export interface SchedulingState {
  presetId?: string;
  recentPairingId?: string;
  meetingTypeId?: string;
  meetingTypeName?: string;
  duration?: number;
  externalAttendees: ExternalAttendee[];
  hostAttorneyId?: string;
  hostAttorneyName?: string;
  supportStaffIds: string[];
  locationMode?: LocationMode;
  inPersonLocation?: InPersonLocation;
  roomId?: string;
  preferences: MeetingPreferences;
  suggestedSlots: SuggestedSlot[];
  selectedSlot?: SuggestedSlot;
  overrideModeActive: boolean;
  searchWindowDays: number;
}

export interface SuggestedSlot {
  id: string;
  startTime: Date;
  endTime: Date;
  displayText: string;
}

interface ChatContextType {
  messages: ChatMessage[];
  currentStep: ChatStep;
  schedulingState: SchedulingState;
  isTyping: boolean;
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  setCurrentStep: (step: ChatStep) => void;
  updateSchedulingState: (updates: Partial<SchedulingState>) => void;
  resetChat: () => void;
  setIsTyping: (typing: boolean) => void;
}

const initialSchedulingState: SchedulingState = {
  externalAttendees: [],
  supportStaffIds: [],
  preferences: {
    timezone: 'America/New_York',
    weekends_allowed: false,
  },
  suggestedSlots: [],
  overrideModeActive: false,
  searchWindowDays: 30,
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStep, setCurrentStep] = useState<ChatStep>('start');
  const [schedulingState, setSchedulingState] = useState<SchedulingState>(initialSchedulingState);
  const [isTyping, setIsTyping] = useState(false);

  const addMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMessage: ChatMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  }, []);

  const updateSchedulingState = useCallback((updates: Partial<SchedulingState>) => {
    setSchedulingState((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetChat = useCallback(() => {
    setMessages([]);
    setCurrentStep('start');
    setSchedulingState(initialSchedulingState);
    setIsTyping(false);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        currentStep,
        schedulingState,
        isTyping,
        addMessage,
        setCurrentStep,
        updateSchedulingState,
        resetChat,
        setIsTyping,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
