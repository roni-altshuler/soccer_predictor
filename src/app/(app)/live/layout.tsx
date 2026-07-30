import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Live Intelligence · Pitchverse',
  description:
    'Every live match, read by the model in real time — win probability, the pre-match→now shift, historical base rates, and the likeliest finish across the leagues we cover.',
}

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return children
}
