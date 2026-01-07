import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarX, ChevronLeft, ChevronRight, RefreshCw, Phone, Mail } from "lucide-react";

interface NoAvailableTimesStateProps {
  onTryPreviousWeek?: () => void;
  onTryNextWeek?: () => void;
  onRefresh: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  isRefreshing: boolean;
  contactEmail?: string;
  contactPhone?: string;
  contactMessage?: string;
}

export function NoAvailableTimesState({
  onTryPreviousWeek,
  onTryNextWeek,
  onRefresh,
  canGoPrevious,
  canGoNext,
  isRefreshing,
  contactEmail,
  contactPhone,
  contactMessage
}: NoAvailableTimesStateProps) {
  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <CalendarX className="h-5 w-5" />
          No times available right now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          We couldn't find any available times for the period you're viewing. This might be because:
        </p>
        
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-amber-600 dark:text-amber-400">•</span>
            <span>The requested time window may be full</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-600 dark:text-amber-400">•</span>
            <span>Some days may be unavailable due to other commitments</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-amber-600 dark:text-amber-400">•</span>
            <span>The meeting length may limit available slots</span>
          </li>
        </ul>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button 
            variant="outline" 
            onClick={onTryPreviousWeek}
            disabled={!canGoPrevious}
            className="flex-1"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous Week
          </Button>
          <Button 
            variant="outline" 
            onClick={onTryNextWeek}
            disabled={!canGoNext}
            className="flex-1"
          >
            Next Week
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        <Button 
          variant="secondary" 
          onClick={onRefresh}
          disabled={isRefreshing}
          className="w-full"
        >
          {isRefreshing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Refreshing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh Times
            </>
          )}
        </Button>

        <div className="border-t pt-4 mt-4">
          <p className="text-sm font-medium text-foreground mb-2">Need assistance?</p>
          {contactMessage && (
            <p className="text-sm text-muted-foreground mb-3">{contactMessage}</p>
          )}
          <div className="space-y-2">
            {contactPhone && (
              <a 
                href={`tel:${contactPhone}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Phone className="h-4 w-4" />
                {contactPhone}
              </a>
            )}
            {contactEmail && (
              <a 
                href={`mailto:${contactEmail}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Mail className="h-4 w-4" />
                {contactEmail}
              </a>
            )}
            {!contactPhone && !contactEmail && (
              <p className="text-sm text-muted-foreground">
                Please contact our office for assistance.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
