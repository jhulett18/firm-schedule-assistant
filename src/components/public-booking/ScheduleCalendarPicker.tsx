import { useMemo, useState, useEffect } from "react";
import { format, parseISO, isSameMonth, isSameDay, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isToday } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ChevronLeft, ChevronRight, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface TimeSlot {
  start: string;
  end: string;
  label: string;
}

interface ScheduleCalendarPickerProps {
  slots: TimeSlot[];
  selectedSlot: TimeSlot | null;
  onSelectSlot: (slot: TimeSlot) => void;
  clientTimezone: string;
  isLoading?: boolean;
  onRefresh?: () => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ScheduleCalendarPicker({
  slots,
  selectedSlot,
  onSelectSlot,
  clientTimezone,
  isLoading = false,
  onRefresh,
}: ScheduleCalendarPickerProps) {
  // Group slots by date key (YYYY-MM-DD) in the client timezone
  const slotsByDate = useMemo(() => {
    const grouped: Record<string, TimeSlot[]> = {};
    
    for (const slot of slots) {
      const zonedDate = toZonedTime(parseISO(slot.start), clientTimezone);
      const dateKey = format(zonedDate, "yyyy-MM-dd");
      
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    }
    
    // Sort slots within each day by time
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
    
    return grouped;
  }, [slots, clientTimezone]);

  // Get available date keys
  const availableDateKeys = useMemo(() => Object.keys(slotsByDate).sort(), [slotsByDate]);

  // State for selected date and displayed month
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [displayedMonth, setDisplayedMonth] = useState<Date>(() => new Date());

  // Auto-select earliest available date on load
  useEffect(() => {
    if (availableDateKeys.length > 0 && !selectedDateKey) {
      const earliest = availableDateKeys[0];
      setSelectedDateKey(earliest);
      // Set displayed month to match earliest date
      const earliestDate = parseISO(earliest);
      setDisplayedMonth(startOfMonth(earliestDate));
    }
  }, [availableDateKeys, selectedDateKey]);

  // Get slots for selected date
  const selectedDaySlots = useMemo(() => {
    if (!selectedDateKey) return [];
    return slotsByDate[selectedDateKey] || [];
  }, [selectedDateKey, slotsByDate]);

  // Generate calendar days for the displayed month
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(displayedMonth);
    const monthEnd = endOfMonth(displayedMonth);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [displayedMonth]);

  // Check if a date has availability
  const hasAvailability = (date: Date) => {
    const dateKey = format(date, "yyyy-MM-dd");
    return availableDateKeys.includes(dateKey);
  };

  // Handle date click
  const handleDateClick = (date: Date) => {
    const dateKey = format(date, "yyyy-MM-dd");
    if (hasAvailability(date)) {
      setSelectedDateKey(dateKey);
    }
  };

  // Month navigation
  const goToPreviousMonth = () => setDisplayedMonth(prev => subMonths(prev, 1));
  const goToNextMonth = () => setDisplayedMonth(prev => addMonths(prev, 1));

  // Empty state
  if (slots.length === 0 && !isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center space-y-4">
            <div className="h-12 w-12 mx-auto rounded-full bg-muted flex items-center justify-center">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium text-foreground">No times available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Please check back later or contact us for assistance.
              </p>
            </div>
            {onRefresh && (
              <Button variant="outline" size="sm" onClick={onRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          {/* Calendar (Left Side) */}
        <div className="p-5 md:p-6 md:border-r border-border flex-shrink-0">
            {/* Month Navigation */}
            <div className="flex items-center justify-between mb-5">
              <Button
                variant="ghost"
                size="icon"
                onClick={goToPreviousMonth}
                className="h-9 w-9"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h3 className="text-base font-semibold text-foreground">
                {format(displayedMonth, "MMMM yyyy")}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={goToNextMonth}
                className="h-9 w-9"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7 gap-1 mb-3">
              {WEEKDAY_LABELS.map(day => (
                <div
                  key={day}
                  className="text-center text-sm font-medium text-muted-foreground py-1.5 w-11"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(day => {
                const dateKey = format(day, "yyyy-MM-dd");
                const isCurrentMonth = isSameMonth(day, displayedMonth);
                const isAvailable = hasAvailability(day);
                const isSelected = selectedDateKey === dateKey;
                const isTodayDate = isToday(day);

                return (
                  <button
                    key={dateKey}
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => handleDateClick(day)}
                    className={cn(
                      "h-11 w-11 text-sm rounded-lg transition-colors relative",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      !isCurrentMonth && "text-muted-foreground/40",
                      isCurrentMonth && !isAvailable && "text-muted-foreground/50",
                      isAvailable && !isSelected && "text-foreground hover:bg-accent/20 font-medium",
                      isSelected && "bg-primary text-primary-foreground font-semibold",
                      isTodayDate && !isSelected && "ring-1 ring-primary/30"
                    )}
                  >
                    {format(day, "d")}
                    {/* Availability dot */}
                    {isAvailable && !isSelected && (
                      <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Times List (Right Side) */}
          <div className="flex-1 p-4 md:p-6 border-t md:border-t-0 border-border min-w-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Choose Time</h3>
                {selectedDateKey && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {format(parseISO(selectedDateKey), "EEEE, MMMM d")}
                  </p>
                )}
              </div>
              {onRefresh && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRefresh}
                  disabled={isLoading}
                  className="h-8 w-8"
                >
                  <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                </Button>
              )}
            </div>

            {/* Loading State */}
            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-11 bg-muted animate-pulse rounded-md" />
                ))}
              </div>
            ) : selectedDaySlots.length > 0 ? (
              <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {selectedDaySlots.map((slot, index) => {
                  const slotTime = toZonedTime(parseISO(slot.start), clientTimezone);
                  const isSlotSelected = selectedSlot?.start === slot.start;

                  return (
                    <Button
                      key={index}
                      variant={isSlotSelected ? "default" : "outline"}
                      className={cn(
                        "w-full justify-center h-11 text-sm font-medium",
                        isSlotSelected && "ring-2 ring-ring ring-offset-2"
                      )}
                      onClick={() => onSelectSlot(slot)}
                    >
                      {format(slotTime, "h:mm a")}
                    </Button>
                  );
                })}
              </div>
            ) : selectedDateKey ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No times available for this date.
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Select a date to see available times.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
