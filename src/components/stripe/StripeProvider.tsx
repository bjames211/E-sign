import React from 'react';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

// Use Stripe test publishable key
// In production, this should come from environment variables
const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'
);

interface StripeProviderProps {
  children: React.ReactNode;
  clientSecret?: string;
}

export function StripeProvider({ children, clientSecret }: StripeProviderProps) {
  const options = clientSecret
    ? {
        clientSecret,
        appearance: {
          theme: 'stripe' as const,
          variables: {
            colorPrimary: '#2196F3',
          },
        },
      }
    : undefined;

  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  );
}
