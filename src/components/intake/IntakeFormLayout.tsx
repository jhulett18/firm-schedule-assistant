import React from "react";

interface IntakeFormLayoutProps {
  children: React.ReactNode;
  title: string;
  step: 1 | 2;
}

const IntakeFormLayout: React.FC<IntakeFormLayoutProps> = ({ children, title, step }) => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header - minimal for iframe embedding */}
      <div className="bg-primary text-primary-foreground px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <h1 className="text-lg font-semibold">{title}</h1>
          <div className="text-sm">
            Step {step} of 2
          </div>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="bg-muted px-4 py-2">
        <div className="max-w-2xl mx-auto flex gap-2">
          <div 
            className={`flex-1 h-2 rounded-full ${
              step >= 1 ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          />
          <div
            className={`flex-1 h-2 rounded-full ${
              step >= 2 ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          />
        </div>
      </div>

      {/* Form content */}
      <div className="px-4 py-6">
        <div className="max-w-2xl mx-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default IntakeFormLayout;
