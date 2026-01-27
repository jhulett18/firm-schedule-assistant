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
import { Loader2, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const US_STATES = [
  { id: "AL", name: "Alabama" }, { id: "AK", name: "Alaska" }, { id: "AZ", name: "Arizona" },
  { id: "AR", name: "Arkansas" }, { id: "CA", name: "California" }, { id: "CO", name: "Colorado" },
  { id: "CT", name: "Connecticut" }, { id: "DE", name: "Delaware" }, { id: "FL", name: "Florida" },
  { id: "GA", name: "Georgia" }, { id: "HI", name: "Hawaii" }, { id: "ID", name: "Idaho" },
  { id: "IL", name: "Illinois" }, { id: "IN", name: "Indiana" }, { id: "IA", name: "Iowa" },
  { id: "KS", name: "Kansas" }, { id: "KY", name: "Kentucky" }, { id: "LA", name: "Louisiana" },
  { id: "ME", name: "Maine" }, { id: "MD", name: "Maryland" }, { id: "MA", name: "Massachusetts" },
  { id: "MI", name: "Michigan" }, { id: "MN", name: "Minnesota" }, { id: "MS", name: "Mississippi" },
  { id: "MO", name: "Missouri" }, { id: "MT", name: "Montana" }, { id: "NE", name: "Nebraska" },
  { id: "NV", name: "Nevada" }, { id: "NH", name: "New Hampshire" }, { id: "NJ", name: "New Jersey" },
  { id: "NM", name: "New Mexico" }, { id: "NY", name: "New York" }, { id: "NC", name: "North Carolina" },
  { id: "ND", name: "North Dakota" }, { id: "OH", name: "Ohio" }, { id: "OK", name: "Oklahoma" },
  { id: "OR", name: "Oregon" }, { id: "PA", name: "Pennsylvania" }, { id: "RI", name: "Rhode Island" },
  { id: "SC", name: "South Carolina" }, { id: "SD", name: "South Dakota" }, { id: "TN", name: "Tennessee" },
  { id: "TX", name: "Texas" }, { id: "UT", name: "Utah" }, { id: "VT", name: "Vermont" },
  { id: "VA", name: "Virginia" }, { id: "WA", name: "Washington" }, { id: "WV", name: "West Virginia" },
  { id: "WI", name: "Wisconsin" }, { id: "WY", name: "Wyoming" }, { id: "DC", name: "District of Columbia" },
];

const GENDER_OPTIONS = [
  { id: "male", name: "Male" },
  { id: "female", name: "Female" },
  { id: "non_binary", name: "Non-Binary" },
  { id: "prefer_not_to_say", name: "Prefer not to say" },
];

const formSchema = z.object({
  preferred_name: z.string().max(100).optional(),
  gender: z.string().optional(),
  address_line_1: z.string().max(200).optional(),
  address_line_2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().optional(),
  zip: z.string().max(20).optional(),
  practice_area_id: z.string().min(1, "Practice area is required"),
  source_id: z.string().min(1, "Please tell us how you heard about us"),
  is_second_client: z.string().min(1, "Please select an option"),
  additional_people: z.string().max(2000).optional(),
  matter_description: z.string().max(2000).optional(),
  intake_notes: z.string().max(2000).optional(),
  next_steps_intake: z.string().min(1, "Please select next steps"),
});

type FormData = z.infer<typeof formSchema>;

const IntakeDetails: React.FC = () => {
  const navigate = useNavigate();
  const [practiceAreas, setPracticeAreas] = useState<Array<{ id: string; name: string }>>([]);
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([]);
  const [stages, setStages] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      preferred_name: "",
      gender: "",
      address_line_1: "",
      address_line_2: "",
      city: "",
      state: "",
      zip: "",
      practice_area_id: "",
      source_id: "",
      is_second_client: "",
      additional_people: "",
      matter_description: "",
      intake_notes: "",
      next_steps_intake: "",
    },
  });

  // Check for Page 1 data
  useEffect(() => {
    const savedContact = sessionStorage.getItem("intake_contact_data");
    if (!savedContact) {
      toast({
        title: "Please complete Contact Information first",
        variant: "destructive",
      });
      navigate("/intake/contact");
    }
  }, [navigate]);

  // Fetch dropdown options
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [practiceAreasRes, sourcesRes, stagesRes] = await Promise.all([
          supabase.functions.invoke("lawmatics-list-practice-areas"),
          supabase.functions.invoke("lawmatics-list-sources"),
          supabase.functions.invoke("lawmatics-list-stages"),
        ]);

        setPracticeAreas(practiceAreasRes.data?.items || []);
        setSources(sourcesRes.data?.items || []);
        setStages(stagesRes.data?.items || []);
      } catch (err) {
        console.error("Failed to fetch options:", err);
        // Fallback options
        setPracticeAreas([
          { id: "family_law", name: "Family Law" },
          { id: "criminal_defense", name: "Criminal Defense" },
          { id: "personal_injury", name: "Personal Injury" },
          { id: "estate_planning", name: "Estate Planning" },
        ]);
        setSources([
          { id: "google", name: "Google Search" },
          { id: "referral", name: "Referral" },
          { id: "social", name: "Social Media" },
          { id: "other", name: "Other" },
        ]);
        setStages([
          { id: "new_lead", name: "New Lead" },
          { id: "consultation_scheduled", name: "Consultation Scheduled" },
        ]);
      } finally {
        setLoadingOptions(false);
      }
    };
    fetchOptions();
  }, []);

  const onSubmit = async (data: FormData) => {
    setSubmitStatus("submitting");
    setSubmitError(null);

    try {
      // Get contact data from Page 1
      const savedContact = sessionStorage.getItem("intake_contact_data");
      if (!savedContact) {
        throw new Error("Contact information not found. Please go back to step 1.");
      }

      const contactData = JSON.parse(savedContact);
      
      // Combine all data
      const combinedData = {
        ...contactData,
        ...data,
      };

      // Submit to Lawmatics
      const { data: result, error } = await supabase.functions.invoke("lawmatics-submit-intake", {
        body: combinedData,
      });

      if (error) throw error;

      if (result?.success) {
        setSubmitStatus("success");
        // Clear session storage
        sessionStorage.removeItem("intake_contact_data");
      } else {
        throw new Error(result?.errors?.contact || result?.errors?.matter || "Submission failed");
      }
    } catch (err) {
      console.error("Submit error:", err);
      setSubmitStatus("error");
      setSubmitError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const goBack = () => {
    navigate("/intake/contact");
  };

  // Success state
  if (submitStatus === "success") {
    return (
      <IntakeFormLayout title="Intake Information" step={2}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Thank You!
          </h2>
          <p className="text-gray-600 max-w-md">
            Your intake information has been submitted successfully. 
            Our team will review your information and get back to you shortly.
          </p>
        </div>
      </IntakeFormLayout>
    );
  }

  // Error state
  if (submitStatus === "error") {
    return (
      <IntakeFormLayout title="Intake Information" step={2}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <XCircle className="h-16 w-16 text-red-500 mb-4" />
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Submission Failed
          </h2>
          <p className="text-gray-600 max-w-md mb-4">
            {submitError || "An error occurred while submitting your information."}
          </p>
          <Button onClick={() => setSubmitStatus("idle")}>
            Try Again
          </Button>
        </div>
      </IntakeFormLayout>
    );
  }

  const gender = watch("gender");
  const state = watch("state");
  const practiceAreaId = watch("practice_area_id");
  const sourceId = watch("source_id");
  const isSecondClient = watch("is_second_client");
  const nextStepsIntake = watch("next_steps_intake");

  return (
    <IntakeFormLayout title="Intake Information" step={2}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Preferred Name and Gender */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="preferred_name">Preferred Name</Label>
            <Input
              id="preferred_name"
              {...register("preferred_name")}
              placeholder="Preferred name"
            />
          </div>

          <div className="space-y-2">
            <Label>Gender</Label>
            <Select
              value={gender}
              onValueChange={(value) => setValue("gender", value)}
            >
              <SelectTrigger className="bg-white">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                {GENDER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Address */}
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Address (Primary)</h3>
          
          <div className="space-y-2">
            <Label htmlFor="address_line_1">Street</Label>
            <Input
              id="address_line_1"
              {...register("address_line_1")}
              placeholder="Street address"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address_line_2">Street 2</Label>
            <Input
              id="address_line_2"
              {...register("address_line_2")}
              placeholder="Apt, Suite, Unit, etc."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                {...register("city")}
                placeholder="City"
              />
            </div>

            <div className="space-y-2">
              <Label>State</Label>
              <Select
                value={state}
                onValueChange={(value) => setValue("state", value)}
              >
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="Select state..." />
                </SelectTrigger>
                <SelectContent className="bg-white z-50 max-h-60">
                  {US_STATES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="zip">Zipcode</Label>
              <Input
                id="zip"
                {...register("zip")}
                placeholder="12345"
              />
            </div>
          </div>
        </div>

        {/* Practice Area and Source */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>
              Practice Area <span className="text-red-500">*</span>
            </Label>
            <Select
              value={practiceAreaId}
              onValueChange={(value) => setValue("practice_area_id", value)}
              disabled={loadingOptions}
            >
              <SelectTrigger className="bg-white">
                {loadingOptions ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SelectValue placeholder="Select practice area..." />
                )}
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                {practiceAreas.map((pa) => (
                  <SelectItem key={pa.id} value={pa.id}>
                    {pa.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.practice_area_id && (
              <p className="text-sm text-red-500">{errors.practice_area_id.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>
              How Did You Hear About Us? <span className="text-red-500">*</span>
            </Label>
            <Select
              value={sourceId}
              onValueChange={(value) => setValue("source_id", value)}
              disabled={loadingOptions}
            >
              <SelectTrigger className="bg-white">
                {loadingOptions ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SelectValue placeholder="Select..." />
                )}
              </SelectTrigger>
              <SelectContent className="bg-white z-50">
                {sources.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.source_id && (
              <p className="text-sm text-red-500">{errors.source_id.message}</p>
            )}
          </div>
        </div>

        {/* Second Client */}
        <div className="space-y-2">
          <Label>
            Is there a second client? <span className="text-red-500">*</span>
          </Label>
          <Select
            value={isSecondClient}
            onValueChange={(value) => setValue("is_second_client", value)}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent className="bg-white z-50">
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
          {errors.is_second_client && (
            <p className="text-sm text-red-500">{errors.is_second_client.message}</p>
          )}
        </div>

        {/* Additional People */}
        <div className="space-y-2">
          <Label htmlFor="additional_people">Additional People (Conflict Check)</Label>
          <Textarea
            id="additional_people"
            {...register("additional_people")}
            placeholder="List any additional people involved (opposing parties, witnesses, etc.)"
            rows={3}
          />
        </div>

        {/* Matter Description */}
        <div className="space-y-2">
          <Label htmlFor="matter_description">Matter's Description</Label>
          <Textarea
            id="matter_description"
            {...register("matter_description")}
            placeholder="Brief description of the legal matter..."
            rows={4}
          />
        </div>

        {/* Intake Notes */}
        <div className="space-y-2">
          <Label htmlFor="intake_notes">Intake Notes</Label>
          <Textarea
            id="intake_notes"
            {...register("intake_notes")}
            placeholder="Additional intake notes..."
            rows={3}
          />
        </div>

        {/* Next Steps */}
        <div className="space-y-2">
          <Label>
            Next Steps <span className="text-red-500">*</span>
          </Label>
          <Select
            value={nextStepsIntake}
            onValueChange={(value) => setValue("next_steps_intake", value)}
            disabled={loadingOptions}
          >
            <SelectTrigger className="bg-white">
              {loadingOptions ? (
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
          {errors.next_steps_intake && (
            <p className="text-sm text-red-500">{errors.next_steps_intake.message}</p>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-between pt-4">
          <Button type="button" variant="outline" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button 
            type="submit" 
            disabled={submitStatus === "submitting"} 
            className="min-w-32"
          >
            {submitStatus === "submitting" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Submit"
            )}
          </Button>
        </div>
      </form>
    </IntakeFormLayout>
  );
};

export default IntakeDetails;
