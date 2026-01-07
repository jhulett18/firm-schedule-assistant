import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

interface NextActionCardProps {
  action: {
    label: string;
    description: string;
    href: string;
    variant: "default" | "destructive";
  };
  isLoading: boolean;
}

export function NextActionCard({ action, isLoading }: NextActionCardProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="border-2 border-accent">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            Next Step
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-full" />
            <div className="h-10 bg-muted rounded w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-accent bg-gradient-to-br from-accent/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          Next Step
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-foreground">{action.label}</h3>
            <p className="text-sm text-muted-foreground">{action.description}</p>
          </div>
          <Button
            onClick={() => navigate(action.href)}
            variant={action.variant}
            className="gap-2"
          >
            {action.label}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
