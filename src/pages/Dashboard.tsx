import { MainLayout } from "@/components/layout/MainLayout";
import { useDashboardData } from "@/hooks/useDashboardData";
import { SystemStatusCard } from "@/components/dashboard/SystemStatusCard";
import { NextActionCard } from "@/components/dashboard/NextActionCard";
import { QuickLinksCard } from "@/components/dashboard/QuickLinksCard";
import { SetupChecklist } from "@/components/dashboard/SetupChecklist";
import { HowItWorks } from "@/components/dashboard/HowItWorks";
import { RecentActivity } from "@/components/dashboard/RecentActivity";

export default function Dashboard() {
  const {
    systemStatus,
    setupSteps,
    progressPercent,
    nextAction,
    recentMeetings,
    isLoading: dataLoading,
  } = useDashboardData();

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center sm:text-left">
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Welcome to LawScheduler
          </h1>
          <p className="text-muted-foreground mt-1">
            Send scheduling links to clients without maintaining hundreds of Lawmatics schedulers.
          </p>
        </div>

        {/* Top cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SystemStatusCard status={systemStatus} isLoading={dataLoading} />
          <NextActionCard action={nextAction} isLoading={dataLoading} />
          <QuickLinksCard />
        </div>

        {/* Setup Checklist */}
        {progressPercent < 100 && (
          <SetupChecklist
            steps={setupSteps}
            progressPercent={progressPercent}
            isLoading={dataLoading}
          />
        )}

        {/* How it works */}
        <HowItWorks />

        {/* Recent Activity */}
        <RecentActivity meetings={recentMeetings} isLoading={dataLoading} />
      </div>
    </MainLayout>
  );
}
