import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import Footer from '@/components/layout/Footer';

export default function Terms() {
  const { data: settings } = useQuery({
    queryKey: ['app-settings-terms'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['public_contact_email', 'legal_company_name']);
      return data?.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>) || {};
    },
    staleTime: 1000 * 60 * 5,
  });

  const companyName = settings?.legal_company_name || 'LawScheduler';
  const contactEmail = settings?.public_contact_email || 'Contact your law office';
  const lastUpdated = 'January 2026';

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card py-4">
        <div className="container max-w-4xl mx-auto px-4">
          <Link to="/home" className="flex items-center gap-2 text-foreground hover:text-primary transition-colors">
            <Scale className="w-5 h-5" />
            <span className="font-serif font-semibold">LawScheduler</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 py-12">
        <div className="container max-w-3xl mx-auto px-4">
          <h1 className="text-3xl md:text-4xl font-serif font-semibold mb-2">Terms of Service</h1>
          <p className="text-muted-foreground mb-8">Last updated: {lastUpdated}</p>

          <div className="prose prose-slate max-w-none space-y-8">
            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Service Description</h2>
              <p className="text-muted-foreground leading-relaxed">
                {companyName} ("the Service") is a scheduling application that enables legal offices to create 
                booking requests and allows clients to select available appointment times. The Service integrates 
                with Google Calendar for availability checking and Lawmatics for appointment creation.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Eligibility</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service has two types of users:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li><strong>Staff Users</strong> — Authorized employees of the law office who create and manage 
                booking requests. Staff accounts require authentication and are subject to access controls set 
                by administrators.</li>
                <li><strong>Public Users</strong> — Clients who access the Service via scheduling links to select 
                appointment times. Public users do not require accounts and access is limited to their specific 
                booking request.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Acceptable Use</h2>
              <p className="text-muted-foreground leading-relaxed">You agree to use the Service only for its intended purposes:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li>Creating and managing legitimate appointment booking requests</li>
                <li>Selecting available appointment times through provided scheduling links</li>
                <li>Accessing only those features and data you are authorized to use</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">You agree not to:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li>Attempt to access accounts or data belonging to others</li>
                <li>Use the Service to transmit harmful content or malware</li>
                <li>Interfere with the proper operation of the Service</li>
                <li>Use automated systems to access the Service without permission</li>
                <li>Violate any applicable laws or regulations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">No Legal Advice</h2>
              <p className="text-muted-foreground leading-relaxed">
                <strong>The Service is a scheduling tool only.</strong> Nothing in the Service constitutes legal 
                advice. The Service does not create an attorney-client relationship. Scheduling an appointment 
                through this Service does not guarantee representation or create any legal obligations beyond the 
                scheduled meeting itself.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Availability and Uptime</h2>
              <p className="text-muted-foreground leading-relaxed">
                We strive to maintain high availability of the Service, but we do not guarantee uninterrupted 
                access. The Service may be temporarily unavailable due to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li>Scheduled maintenance and updates</li>
                <li>Unplanned outages or technical issues</li>
                <li>Issues with third-party services (Google Calendar, Lawmatics)</li>
                <li>Circumstances beyond our reasonable control</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We are not liable for any damages resulting from Service unavailability.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Third-Party Integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service integrates with third-party services including Google Calendar and Lawmatics. Your 
                use of these integrations is subject to the respective terms of service and privacy policies of 
                those providers. We are not responsible for the availability, accuracy, or functionality of 
                third-party services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, {companyName.toUpperCase()} SHALL NOT BE LIABLE FOR ANY 
                INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO 
                LOSS OF PROFITS, DATA, USE, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li>Your access to or use of (or inability to access or use) the Service</li>
                <li>Any conduct or content of any third party on the Service</li>
                <li>Unauthorized access, use, or alteration of your data</li>
                <li>Missed appointments or scheduling errors</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Disclaimer of Warranties</h2>
              <p className="text-muted-foreground leading-relaxed">
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS 
                OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A 
                PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Changes to Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may modify these Terms at any time. We will notify users of material changes by updating the 
                "Last updated" date and, for staff users, through in-app notifications. Continued use of the 
                Service after changes constitutes acceptance of the modified Terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Governing Law</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms shall be governed by and construed in accordance with applicable laws, without regard 
                to conflict of law principles.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about these Terms of Service, please contact:
              </p>
              <p className="text-foreground mt-2 font-medium">{contactEmail}</p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
