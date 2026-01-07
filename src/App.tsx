import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { StaffRoute } from "@/components/auth/StaffRoute";
import { ClientRoute } from "@/components/auth/ClientRoute";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import PublicBooking from "./pages/PublicBooking";
import Requests from "./pages/Requests";
import RequestNew from "./pages/RequestNew";
import Help from "./pages/Help";
import ClientHome from "./pages/ClientHome";
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
            <Route
              path="/dashboard"
              element={
                <StaffRoute>
                  <Dashboard />
                </StaffRoute>
              }
            />
            <Route
              path="/client"
              element={
                <ClientRoute>
                  <ClientHome />
                </ClientRoute>
              }
            />
            <Route
              path="/requests"
              element={
                <StaffRoute>
                  <Requests />
                </StaffRoute>
              }
            />
            <Route
              path="/requests/new"
              element={
                <StaffRoute>
                  <RequestNew />
                </StaffRoute>
              }
            />
            <Route
              path="/help"
              element={
                <StaffRoute>
                  <Help />
                </StaffRoute>
              }
            />
            <Route path="/r/:token" element={<PublicBooking />} />
            <Route
              path="/admin/users"
              element={
                <AdminRoute>
                  <AdminUsers />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/rooms"
              element={
                <AdminRoute>
                  <AdminRooms />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/meeting-types"
              element={
                <AdminRoute>
                  <AdminMeetingTypes />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/presets"
              element={
                <AdminRoute>
                  <AdminPresets />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/scheduler-mapping"
              element={
                <AdminRoute>
                  <AdminSchedulerMapping />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/settings"
              element={
                <AdminRoute>
                  <AdminSettings />
                </AdminRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
