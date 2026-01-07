import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LoadingState } from '@/components/public-booking/LoadingState';

const ACTIVE_BOOKING_TOKEN_KEY = 'ACTIVE_BOOKING_TOKEN';

/**
 * /r/:token - Public redirector only
 * Captures token from URL, stores in localStorage, and redirects to /client
 */
export default function TokenRedirect() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (token) {
      // Store token in localStorage
      localStorage.setItem(ACTIVE_BOOKING_TOKEN_KEY, token);
      // Redirect to client view
      navigate('/client', { replace: true });
    } else {
      // No token provided - redirect to access page
      navigate('/access', { replace: true });
    }
  }, [token, navigate]);

  // Show loading while redirecting
  return <LoadingState />;
}
