import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export default function Footer() {
  const { data: settings } = useQuery({
    queryKey: ['app-settings-footer'],
    queryFn: async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['legal_company_name']);
      return data?.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>) || {};
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });

  const companyName = settings?.legal_company_name || 'LawScheduler';

  return (
    <footer className="w-full border-t border-border bg-card py-6 mt-auto">
      <div className="container max-w-4xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Scale className="w-4 h-4" />
            <span className="text-sm">© {new Date().getFullYear()} {companyName}</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link 
              to="/home" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Home
            </Link>
            <Link 
              to="/privacy" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Privacy Policy
            </Link>
            <Link 
              to="/terms" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Terms of Service
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
