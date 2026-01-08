import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Scale, FileText, Calendar, CheckCircle, Shield, Mail, Phone, ArrowRight, KeyRound } from 'lucide-react';
import Footer from '@/components/layout/Footer';

export default function Home() {
  const { data: settings } = useQuery({
    queryKey: ['app-settings-home'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['public_contact_email', 'public_contact_phone', 'public_contact_message']);
      return data?.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>) || {};
    },
    staleTime: 1000 * 60 * 5,
  });

  const contactEmail = settings?.public_contact_email || '';
  const contactPhone = settings?.public_contact_phone || '';
  const contactMessage = settings?.public_contact_message || 'Contact your law office for assistance.';

  const steps = [
    { icon: FileText, title: 'Office Creates Request', description: 'Staff creates a booking request with meeting preferences' },
    { icon: KeyRound, title: 'Client Receives Link', description: 'Client gets a unique scheduling link via email' },
    { icon: Calendar, title: 'Client Picks Time', description: 'Client selects an available time slot that works for them' },
    { icon: CheckCircle, title: 'Appointment Created', description: 'Meeting is automatically created in Lawmatics calendar' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Hero Section */}
      <section className="gradient-subtle py-16 md:py-24">
        <div className="container max-w-4xl mx-auto px-4 text-center">
          <div className="mx-auto w-16 h-16 rounded-xl gradient-primary flex items-center justify-center mb-6">
            <Scale className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-semibold text-foreground mb-4">
            LawScheduler
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Schedule legal appointments without complex scheduling forms.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg">
              <Link to="/auth">
                Log In
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/access">
                <KeyRound className="w-4 h-4 mr-2" />
                Enter Scheduling Code
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-card">
        <div className="container max-w-4xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-serif text-center mb-12">How It Works</h2>
          <div className="grid md:grid-cols-4 gap-6">
            {steps.map((step, index) => (
              <Card key={index} className="text-center border-0 shadow-sm">
                <CardContent className="pt-6">
                  <div className="mx-auto w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-4">
                    <step.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Step {index + 1}</div>
                  <h3 className="font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Data & Security */}
      <section className="py-16 bg-background">
        <div className="container max-w-4xl mx-auto px-4">
          <div className="flex items-start gap-4 p-6 bg-card rounded-lg border">
            <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-serif font-semibold mb-2">Data & Security</h2>
              <ul className="space-y-2 text-muted-foreground">
                <li>• Clients only see available time slots—no sensitive calendar event details are displayed</li>
                <li>• Scheduling tokens provide access only to the specific booking request</li>
                <li>• Calendar availability is checked securely via read-only access</li>
                <li>• All data is encrypted in transit and at rest</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section className="py-16 bg-card">
        <div className="container max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-serif text-center mb-8">Support & Contact</h2>
          <div className="text-center space-y-4">
            <p className="text-muted-foreground">{contactMessage}</p>
            {(contactEmail || contactPhone) && (
              <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                {contactEmail && (
                  <a 
                    href={`mailto:${contactEmail}`}
                    className="flex items-center gap-2 text-primary hover:underline"
                  >
                    <Mail className="w-4 h-4" />
                    {contactEmail}
                  </a>
                )}
                {contactPhone && (
                  <a 
                    href={`tel:${contactPhone}`}
                    className="flex items-center gap-2 text-primary hover:underline"
                  >
                    <Phone className="w-4 h-4" />
                    {contactPhone}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
