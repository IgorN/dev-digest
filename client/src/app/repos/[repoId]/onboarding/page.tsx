import { OnboardingView } from "./_components/OnboardingView";

/* Route: /repos/:repoId/onboarding (Onboarding Tour). Thin entry — all state,
   hooks, sections, styles and helpers are colocated in the 'use client'
   OnboardingView leaf. Repo scope comes from the :repoId route param. */
export default function OnboardingPage() {
  return <OnboardingView />;
}
