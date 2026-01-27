import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import IntakeFormLayout from "@/components/intake/IntakeFormLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

const formSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  middle_name: z.string().max(100).optional(),
  last_name: z.string().min(1, "Last name is required").max(100),
  phone: z.string().max(20).optional(),
  email: z.string().email("Valid email is required").max(255),
  is_existing_client: z.string().min(1, "Please select an option"),
  next_steps_contact: z.string().min(1, "Please select next steps"),
  notes_message: z.string().max(2000).optional(),
});

type FormData = z.infer<typeof formSchema>;

const IntakeContact: React.FC = () => {
  const navigate = useNavigate();
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingStages, setLoadingStages] = useState(true);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      first_name: "",
      middle_name: "",
      last_name: "",
      phone: "",
      email: "",
      is_existing_client: "",
      next_steps_contact: "",
      notes_message: "",
    },
  });

  // Load saved data from sessionStorage
  useEffect(() => {
    const saved = sessionStorage.getItem("intake_contact_data");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        Object.entries(data).forEach(([key, value]) => {
          setValue(key as keyof FormData, value as string);
        });
      } catch (e) {
        console.error("Failed to parse saved data:", e);
      }
    }
  }, [setValue]);

  // Fetch stages for Next Steps dropdown
  useEffect(() => {
    const fetchStages = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("lawmatics-list-stages");
        if (error) throw error;
        setStages(data?.items || []);
      } catch (err) {
        console.error("Failed to fetch stages:", err);
        // Fallback options
        setStages([
          { id: "new_lead", name: "New Lead" },
          { id: "contacted", name: "Contacted" },
          { id: "consultation_scheduled", name: "Consultation Scheduled" },
          { id: "follow_up", name: "Follow Up" },
        ]);
      } finally {
        setLoadingStages(false);
      }
    };
    fetchStages();
  }, []);

  const onSubmit = (data: FormData) => {
    // Save to sessionStorage
    sessionStorage.setItem("intake_contact_data", JSON.stringify(data));
    // Navigate to page 2
    navigate("/intake/details");
  };

  const isExistingClient = watch("is_existing_client");
  const nextStepsContact = watch("next_steps_contact");

  return (
    <IntakeFormLayout title="Contact Information" step={1}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Name fields */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="first_name">
              First Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="first_name"
              {...register("first_name")}
              placeholder="First name"
            />
            {errors.first_name && (
              <p className="text-sm text-red-500">{errors.first_name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="middle_name">Middle Name</Label>
            <Input
              id="middle_name"
              {...register("middle_name")}
              placeholder="Middle name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="last_name">
              Last Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="last_name"
              {...register("last_name")}
              placeholder="Last name"
            />
            {errors.last_name && (
              <p className="text-sm text-red-500">{errors.last_name.message}</p>
            )}
          </div>
        </div>

        {/* Contact fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone (Primary)</Label>
            <Input
              id="phone"
              type="tel"
              {...register("phone")}
              placeholder="(555) 555-5555"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">
              Email (Primary) <span className="text-red-500">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              {...register("email")}
              placeholder="email@example.com"
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>
        </div>

        {/* Dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>
              Is this an Existing Client? <span className="text-red-500">*</span>
            </Label>
            <Select
              value={isExistingClient}
              onValueChange={(value) => setValue("is_existing_client", value)}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            {errors.is_existing_client && (
              <p className="text-sm text-red-500">{errors.is_existing_client.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>
              Next Steps <span className="text-red-500">*</span>
            </Label>
            <Select
              value={nextStepsContact}
              onValueChange={(value) => setValue("next_steps_contact", value)}
              disabled={loadingStages}
            >
              <SelectTrigger className="bg-white">
                {loadingStages ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SelectValue placeholder="Select next steps..." />
                )}
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.next_steps_contact && (
              <p className="text-sm text-red-500">{errors.next_steps_contact.message}</p>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-2">
          <Label htmlFor="notes_message">Notes or Message</Label>
          <Textarea
            id="notes_message"
            {...register("notes_message")}
            placeholder="Enter any notes or messages..."
            rows={4}
          />
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={isSubmitting} className="min-w-32">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Next →"
            )}
          </Button>
        </div>
      </form>
    </IntakeFormLayout>
  );
};

export default IntakeContact;
