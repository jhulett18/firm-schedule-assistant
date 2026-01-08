import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { StaffRoute } from "@/components/auth/StaffRoute";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import TokenRedirect from "./pages/TokenRedirect";
import Access from "./pages/Access";
import ClientHome from "./pages/ClientHome";
import Schedule from "./pages/Schedule";
import Requests from "./pages/Requests";
import RequestNew from "./pages/RequestNew";
import Help from "./pages/Help";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminRooms from "./pages/admin/AdminRooms";
import AdminMeetingTypes from "./pages/admin/AdminMeetingTypes";
import AdminPresets from "./pages/admin/AdminPresets";
import AdminSchedulerMapping from "./pages/admin/AdminSchedulerMapping";
import AdminSettings from "./pages/admin/AdminSettings";
import Home from "./pages/Home";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";

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
            {/* Public legal pages - no auth required */}
            <Route path="/home" element={<Home />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {/* Public routes - no auth required */}
            <Route path="/access" element={<Access />} />
            <Route path="/client" element={<ClientHome />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/r/:token" element={<TokenRedirect />} />
            <Route path="/r/:token/*" element={<TokenRedirect />} />
            {/* Staff/Admin routes */}
            <Route
              path="/dashboard"
              element={
                <StaffRoute>
                  <Dashboard />
                </StaffRoute>
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
            {/* Admin routes */}
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
