import { toast } from "sonner";

export async function copyToClipboard(text: string, successMessage = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  } catch (err) {
    console.error("Failed to copy:", err);
    toast.error("Failed to copy to clipboard");
    return false;
  }
}

export function generateClientEmailTemplate(params: {
  clientName: string;
  meetingTypeName: string;
  bookingUrl: string;
  expiresAt: string;
}) {
  return `Hi ${params.clientName},

We're ready to schedule your ${params.meetingTypeName}.

Please click the link below to select a time that works best for you:

${params.bookingUrl}

This link will expire on ${params.expiresAt}.

If you have any questions, please don't hesitate to reach out.

Best regards,
[Your Name]
[Your Firm Name]`;
}

export function getBookingUrl(token: string) {
  const baseUrl = window.location.origin;
  return `${baseUrl}/r/${token}`;
}
