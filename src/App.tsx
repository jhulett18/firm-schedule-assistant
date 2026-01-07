import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminRoute } from "@/components/admin/AdminRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import PublicBooking from "./pages/PublicBooking";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminRooms from "./pages/admin/AdminRooms";
import AdminMeetingTypes from "./pages/admin/AdminMeetingTypes";
import AdminPresets from "./pages/admin/AdminPresets";
import AdminSchedulerMapping from "./pages/admin/AdminSchedulerMapping";
import AdminSettings from "./pages/admin/AdminSettings";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/r/:token" element={<PublicBooking />} />
            <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="/admin/rooms" element={<AdminRoute><AdminRooms /></AdminRoute>} />
            <Route path="/admin/meeting-types" element={<AdminRoute><AdminMeetingTypes /></AdminRoute>} />
            <Route path="/admin/presets" element={<AdminRoute><AdminPresets /></AdminRoute>} />
            <Route path="/admin/scheduler-mapping" element={<AdminRoute><AdminSchedulerMapping /></AdminRoute>} />
            <Route path="/admin/settings" element={<AdminRoute><AdminSettings /></AdminRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
