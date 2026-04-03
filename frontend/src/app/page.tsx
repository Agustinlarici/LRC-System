import type { Metadata } from 'next';
import { HomeCards } from './HomeCards';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return <HomeCards />;
}
