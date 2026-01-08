import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Scale, Link as LinkIcon, ArrowRight, ArrowLeft } from 'lucide-react';
import Footer from '@/components/layout/Footer';

const ACTIVE_BOOKING_TOKEN_KEY = 'ACTIVE_BOOKING_TOKEN';

export default function Access() {
  const navigate = useNavigate();
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');

  const extractToken = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;
    
    // Check if it's a full URL containing /r/<token>
    const urlMatch = trimmed.match(/\/r\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch) {
      return urlMatch[1];
    }
    
    // Otherwise treat the whole input as a token
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return trimmed;
    }
    
    return null;
  };

  const handleContinue = () => {
    setError('');
    const token = extractToken(tokenInput);
    
    if (!token) {
      setError('Please enter a valid scheduling link or code');
      return;
    }
    
    localStorage.setItem(ACTIVE_BOOKING_TOKEN_KEY, token);
    navigate('/client');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleContinue();
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg animate-fade-in">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-xl bg-primary flex items-center justify-center mb-2">
            <Scale className="w-7 h-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-serif">Enter Your Scheduling Code</CardTitle>
          <CardDescription>
            Paste the scheduling link or code you received from our office
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="relative">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="text"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="Paste your link or code here..."
                className="pl-10"
                autoFocus
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          
          <Button 
            onClick={handleContinue} 
            className="w-full" 
            size="lg"
            disabled={!tokenInput.trim()}
          >
            Continue
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>

          <div className="text-center pt-4 border-t border-muted">
            <p className="text-sm text-muted-foreground mb-3">
              Looking for staff login?
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/auth')}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
      <Footer />
    </div>
  );
}
