import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import Footer from '@/components/layout/Footer';

export default function Privacy() {
  const { data: settings } = useQuery({
    queryKey: ['app-settings-privacy'],
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
          <h1 className="text-3xl md:text-4xl font-serif font-semibold mb-2">Privacy Policy</h1>
          <p className="text-muted-foreground mb-8">Last updated: {lastUpdated}</p>

          <div className="prose prose-slate max-w-none space-y-8">
            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Overview</h2>
              <p className="text-muted-foreground leading-relaxed">
                {companyName} ("we," "our," or "us") provides a scheduling application designed to facilitate 
                appointment booking between legal offices and their clients. This Privacy Policy explains how we 
                collect, use, and protect information when you use our service.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Information We Collect</h2>
              
              <h3 className="text-lg font-semibold mt-4 mb-2">Account Information (Staff Users)</h3>
              <p className="text-muted-foreground leading-relaxed">
                For internal staff users, we collect email addresses and names to manage authentication and 
                provide access to the scheduling system. This information is used solely for account management 
                and service functionality.
              </p>

              <h3 className="text-lg font-semibold mt-4 mb-2">Scheduling Request Details</h3>
              <p className="text-muted-foreground leading-relaxed">
                When booking requests are created, we collect meeting type, duration preferences, location 
                preferences (virtual or in-person), and time preferences. This information is necessary to 
                match clients with available appointment slots.
              </p>

              <h3 className="text-lg font-semibold mt-4 mb-2">Calendar Data Access</h3>
              <p className="text-muted-foreground leading-relaxed">
                We access Google Calendar data using the <code>calendar.readonly</code> and <code>calendar.events.readonly</code> scopes 
                to check availability (free/busy information) for scheduling purposes. <strong>We do not display 
                calendar event details to clients</strong>—only available time slots are shown. Calendar access is 
                used exclusively to determine availability windows.
              </p>

              <h3 className="text-lg font-semibold mt-4 mb-2">Lawmatics Integration Data</h3>
              <p className="text-muted-foreground leading-relaxed">
                When appointments are confirmed, we create appointments in Lawmatics and store the resulting 
                appointment IDs for record-keeping and synchronization purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">How We Use Information</h2>
              <ul className="list-disc list-inside text-muted-foreground space-y-2">
                <li>To provide and maintain the scheduling service</li>
                <li>To check calendar availability for appointment booking</li>
                <li>To create and manage appointments in integrated systems</li>
                <li>To authenticate and authorize staff users</li>
                <li>To improve and optimize the service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Google User Data Disclosure</h2>
              <p className="text-muted-foreground leading-relaxed">
                Our application requests access to Google Calendar data through the following OAuth scopes:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li><code>calendar.readonly</code> — To read calendar metadata and list calendars</li>
                <li><code>calendar.events.readonly</code> — To check free/busy availability for scheduling</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                <strong>We do not sell, share, or transfer Google user data to third parties</strong> except as 
                necessary to provide the scheduling service. Google Calendar data is accessed only to determine 
                availability and is not stored beyond what is necessary for service functionality.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Data Sharing</h2>
              <p className="text-muted-foreground leading-relaxed">We may share information with:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li><strong>Lawmatics</strong> — To create and manage appointments in your practice management system</li>
                <li><strong>Service Providers</strong> — We use Supabase for database and authentication services, 
                which stores data securely in compliance with industry standards</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We do not sell personal information to third parties.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed">
                Booking request data is retained for as long as necessary to provide the service and maintain 
                appointment records. Calendar access tokens are refreshed as needed and can be revoked at any time. 
                Account information is retained until the account is deleted.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Security Measures</h2>
              <p className="text-muted-foreground leading-relaxed">
                We implement industry-standard security measures including:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 mt-2">
                <li>Encryption of data in transit (HTTPS/TLS)</li>
                <li>Encryption of data at rest</li>
                <li>Secure OAuth 2.0 authentication for third-party integrations</li>
                <li>Role-based access controls for staff users</li>
                <li>Regular security reviews and updates</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">User Choices</h2>
              
              <h3 className="text-lg font-semibold mt-4 mb-2">Revoking Google Calendar Access</h3>
              <p className="text-muted-foreground leading-relaxed">
                Staff users can disconnect their Google Calendar at any time through the Admin Settings page. 
                You can also revoke access directly from your{' '}
                <a 
                  href="https://myaccount.google.com/permissions" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Google Account permissions
                </a>.
              </p>

              <h3 className="text-lg font-semibold mt-4 mb-2">Data Deletion</h3>
              <p className="text-muted-foreground leading-relaxed">
                To request deletion of your data, please contact us at the email address below. We will respond 
                to deletion requests within 30 days.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-serif font-semibold mb-3">Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                For questions about this Privacy Policy or to exercise your privacy rights, please contact:
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
