import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { WeeklyReport, WeeklyReportSummary } from '@shared/api.ts';
import type { AppDeps } from '../app.ts';
import { requireSession, requireSuperAdmin } from '../auth/sessions.ts';
import { HttpError, noStore, parseBody } from '../http.ts';
import { isMonday, weekReport, weekSummaries } from './weekly.ts';

const WEEKS_LISTED = 52;

const WeekParams = z.object({ weekStart: z.iso.date().refine(isMonday, 'weekStart must be a Monday') });

/** What each person did, week by week, for super admins. */
export function registerReportRoutes(app: FastifyInstance, deps: AppDeps) {
  const guard = { onRequest: noStore, preHandler: [requireSession(deps), requireSuperAdmin] };
  const zone = deps.config.reportTimeZone;

  app.get('/admin/reports/weekly', guard, async (): Promise<WeeklyReportSummary[]> => weekSummaries(deps.db, zone, WEEKS_LISTED));

  app.get('/admin/reports/weekly/:weekStart', guard, async (request): Promise<WeeklyReport> => {
    const { weekStart } = parseBody(WeekParams, request.params);
    const report = await weekReport(deps.db, zone, weekStart);
    if (!report) throw new HttpError(404, 'not_found', 'There is no report for that week.');
    return report;
  });
}
