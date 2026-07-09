/**
 * Vercel Cron: feed-poll
 * Replaces the timer-triggered Azure Function of the same purpose. Scheduled in
 * vercel.json; verifies CRON_SECRET and invokes the internal job endpoint.
 */
import type { NextRequest } from 'next/server';
import { runCronJob } from '@/lib/cron';

export async function GET(req: NextRequest) {
  return runCronJob(req, '/api/internal/ingestion/feed-poll');
}
