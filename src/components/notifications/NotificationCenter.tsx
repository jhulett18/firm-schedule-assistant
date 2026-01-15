import { useState } from "react";
import { Bell, CalendarX, CalendarClock, CalendarCheck, Info, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, Notification } from "@/hooks/useNotifications";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const typeIcons = {
  meeting_cancelled: CalendarX,
  meeting_rescheduled: CalendarClock,
  booking_completed: CalendarCheck,
  system: Info,
};

const typeColors = {
  meeting_cancelled: "text-destructive",
  meeting_rescheduled: "text-warning",
  booking_completed: "text-success",
  system: "text-muted-foreground",
};

function NotificationItem({
  notification,
  onMarkAsRead,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
}) {
  const Icon = typeIcons[notification.type] || Info;
  const colorClass = typeColors[notification.type] || "text-muted-foreground";

  const handleClick = () => {
    if (!notification.read) {
      onMarkAsRead(notification.id);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full text-left p-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors",
        !notification.read && "bg-primary/5"
      )}
    >
      <div className="flex gap-3">
        <div className={cn("mt-0.5", colorClass)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={cn("font-medium text-sm", !notification.read && "text-foreground")}>
              {notification.title}
            </p>
            {!notification.read && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
          </p>
        </div>
      </div>
    </button>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAsRead, markAllAsRead, isLoading } = useNotifications();

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="relative"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full min-w-5 h-5 flex items-center justify-center px-1 font-medium">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md max-h-[80vh] flex flex-col p-0">
          <DialogHeader className="px-4 pt-4 pb-2 border-b">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg">Notifications</DialogTitle>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => markAllAsRead()}
                  className="text-xs gap-1.5 h-8"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all as read
                </Button>
              )}
            </div>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No notifications yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  You'll see updates here when clients reschedule or cancel appointments.
                </p>
              </div>
            ) : (
              <div>
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={markAsRead}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
