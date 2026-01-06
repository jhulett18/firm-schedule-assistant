import { useEffect, useCallback } from 'react';
import { useChat, ChatOption } from '@/contexts/ChatContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useChatFlow() {
  const { addMessage, currentStep, setCurrentStep, updateSchedulingState, schedulingState, setIsTyping } = useChat();
  const { internalUser } = useAuth();

  const simulateBotResponse = useCallback((content: string, options?: ChatOption[], extras?: Partial<Parameters<typeof addMessage>[0]>) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      addMessage({ type: 'bot', content, options, ...extras });
    }, 600);
  }, [addMessage, setIsTyping]);

  // Initialize chat
  useEffect(() => {
    if (currentStep === 'start' && internalUser) {
      addMessage({
        type: 'bot',
        content: `Hello ${internalUser.name}! 👋 I'm here to help you schedule a meeting. How would you like to start?`,
        options: [
          { id: 'preset', label: 'Use a preset', value: 'preset' },
          { id: 'recent', label: 'Use recent pairing', value: 'recent' },
          { id: 'scratch', label: 'Start from scratch', value: 'scratch' },
        ],
      });
    }
  }, [currentStep, internalUser, addMessage]);

  const handleOptionSelect = useCallback(async (selectedIds: string[]) => {
    const selectedId = selectedIds[0];

    switch (currentStep) {
      case 'start':
        addMessage({ type: 'user', content: selectedId === 'preset' ? 'Use a preset' : selectedId === 'recent' ? 'Use recent pairing' : 'Start from scratch' });
        setCurrentStep('meeting_type');
        
        // Fetch meeting types
        const { data: meetingTypes } = await supabase.from('meeting_types').select('*').eq('active', true);
        const typeOptions: ChatOption[] = (meetingTypes || []).map(t => ({
          id: t.id,
          label: t.name,
          value: t.id,
        }));
        
        simulateBotResponse('What type of meeting would you like to schedule?', typeOptions);
        break;

      case 'meeting_type':
        const selectedType = schedulingState.meetingTypeName || selectedId;
        addMessage({ type: 'user', content: selectedType });
        updateSchedulingState({ meetingTypeId: selectedId });
        setCurrentStep('duration');
        
        simulateBotResponse('How long should the meeting be?', [
          { id: '30', label: '30 minutes', value: '30' },
          { id: '60', label: '1 hour', value: '60' },
          { id: '90', label: '1.5 hours', value: '90' },
          { id: '120', label: '2 hours', value: '120' },
        ]);
        break;

      case 'duration':
        const durationLabels: Record<string, string> = { '30': '30 minutes', '60': '1 hour', '90': '1.5 hours', '120': '2 hours' };
        addMessage({ type: 'user', content: durationLabels[selectedId] || selectedId });
        updateSchedulingState({ duration: parseInt(selectedId) });
        setCurrentStep('host_attorney');
        
        const { data: attorneys } = await supabase.from('users').select('*').eq('role', 'Attorney').eq('active', true);
        const attorneyOptions: ChatOption[] = (attorneys || []).map(a => ({
          id: a.id,
          label: a.name,
          value: a.id,
          description: a.zoom_oauth_connected ? '✓ Zoom connected' : 'Zoom not connected',
        }));
        
        if (attorneyOptions.length === 0) {
          simulateBotResponse('No attorneys are currently available. Please contact an administrator to add team members.');
        } else {
          simulateBotResponse('Which attorney will host this meeting?', attorneyOptions);
        }
        break;

      case 'host_attorney':
        addMessage({ type: 'user', content: 'Selected attorney' });
        updateSchedulingState({ hostAttorneyId: selectedId });
        setCurrentStep('location_mode');
        
        simulateBotResponse('Where will this meeting take place?', [
          { id: 'Zoom', label: '📹 Zoom', value: 'Zoom', description: 'Virtual meeting' },
          { id: 'InPerson', label: '🏢 In-Person', value: 'InPerson', description: 'At the office' },
        ]);
        break;

      case 'location_mode':
        const locationLabel = selectedId === 'Zoom' ? 'Zoom' : 'In-Person';
        addMessage({ type: 'user', content: locationLabel });
        updateSchedulingState({ locationMode: selectedId as 'Zoom' | 'InPerson' });
        
        if (selectedId === 'InPerson') {
          setCurrentStep('in_person_location');
          const { data: rooms } = await supabase.from('rooms').select('*').eq('active', true);
          const roomOptions: ChatOption[] = [
            ...(rooms || []).map(r => ({ id: r.id, label: r.name, value: r.id })),
            { id: 'AttorneyOffice', label: 'Attorney Office', value: 'AttorneyOffice' },
          ];
          simulateBotResponse('Where in the office?', roomOptions);
        } else {
          setCurrentStep('confirm_booking');
          simulateBotResponse(
            `Great! Here's your meeting summary:\n\n📋 Duration: ${schedulingState.duration} minutes\n📍 Location: Zoom\n\nReady to find available times?`,
            [
              { id: 'find', label: '🔍 Find available times', value: 'find' },
              { id: 'edit', label: '✏️ Edit details', value: 'edit' },
            ]
          );
        }
        break;

      case 'in_person_location':
        addMessage({ type: 'user', content: 'Selected location' });
        updateSchedulingState({ inPersonLocation: selectedId as any, roomId: selectedId !== 'AttorneyOffice' ? selectedId : undefined });
        setCurrentStep('confirm_booking');
        
        simulateBotResponse(
          `Great! Here's your meeting summary:\n\n📋 Duration: ${schedulingState.duration} minutes\n📍 Location: In-Person\n\nReady to find available times?`,
          [
            { id: 'find', label: '🔍 Find available times', value: 'find' },
            { id: 'edit', label: '✏️ Edit details', value: 'edit' },
          ]
        );
        break;

      case 'confirm_booking':
        if (selectedId === 'find') {
          addMessage({ type: 'user', content: 'Find available times' });
          setCurrentStep('booking_complete');
          simulateBotResponse(
            '🎉 Integration with Microsoft 365 and Zoom would fetch real availability here.\n\nFor now, here are sample time slots:',
            [
              { id: 'slot1', label: 'Tomorrow at 10:00 AM', value: 'slot1' },
              { id: 'slot2', label: 'Tomorrow at 2:30 PM', value: 'slot2' },
              { id: 'slot3', label: 'Friday at 11:00 AM', value: 'slot3' },
            ]
          );
        }
        break;

      case 'booking_complete':
        addMessage({ type: 'user', content: 'Selected time slot' });
        addMessage({ type: 'system', content: '✅ Meeting scheduled successfully!' });
        simulateBotResponse(
          'Your meeting has been booked! A calendar invite will be sent to all attendees.\n\nWould you like to schedule another meeting?',
          [{ id: 'new', label: '➕ Schedule another', value: 'new' }]
        );
        break;

      default:
        break;
    }
  }, [currentStep, addMessage, setCurrentStep, simulateBotResponse, updateSchedulingState, schedulingState]);

  const handleTextInput = useCallback((text: string) => {
    addMessage({ type: 'user', content: text });
  }, [addMessage]);

  return { handleOptionSelect, handleTextInput };
}
