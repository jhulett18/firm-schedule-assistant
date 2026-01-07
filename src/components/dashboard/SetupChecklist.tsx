import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, ArrowRight } from "lucide-react";
import type { SetupStep } from "@/hooks/useDashboardData";

interface SetupChecklistProps {
  steps: SetupStep[];
  progressPercent: number;
  isLoading: boolean;
}

export function SetupChecklist({ steps, progressPercent, isLoading }: SetupChecklistProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Setup Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-2 bg-muted rounded" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Setup Checklist</CardTitle>
          <Badge variant="secondary" className="text-sm">
            {progressPercent}% Complete
          </Badge>
        </div>
        <Progress value={progressPercent} className="h-2 mt-2" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                step.completed
                  ? "bg-muted/50 border-transparent"
                  : "bg-card border-border hover:border-accent"
              }`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {step.completed ? (
                  <CheckCircle className="w-5 h-5 text-status-success" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-medium ${
                      step.completed ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                  >
                    {index + 1}. {step.label}
                  </span>
                  {step.required && !step.completed && (
                    <Badge variant="destructive" className="text-xs">
                      Required
                    </Badge>
                  )}
                  {!step.required && !step.completed && (
                    <Badge variant="secondary" className="text-xs">
                      Optional
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">{step.description}</p>
              </div>
              {!step.completed && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="flex-shrink-0 gap-1"
                  onClick={() => navigate(step.href)}
                >
                  {step.ctaLabel}
                  <ArrowRight className="w-3 h-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
