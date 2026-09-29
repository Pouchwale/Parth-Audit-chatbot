import { PDFDocument } from '@cantoo/pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';
import { expect, it } from 'vitest';
import type { FileInfo } from '@shared/api.ts';
import { createDemoConnector } from '../src/connectors/demo/index.ts';
import { ConnectorError, splitResult, type ActionContext, type ActionFile } from '../src/connectors/types.ts';
import { addDays, localDate } from '../src/time.ts';

const PHOTO: FileInfo = {
  id: '5b0c3c9e-8a44-4b53-9d1e-0f6c1d2e3a4b',
  filename: 'exit.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 3,
  origin: 'upload',
  system: null,
  relativePath: null,
  width: null,
  height: null,
  createdAt: '2026-09-27T10:00:00.000Z',
};

/** What a demo action gets to work with: a conversation holding one photo. */
const ctx: ActionContext = {
  credentials: { demo: true },
  files: {
    get: async (fileId) => {
      if (fileId !== PHOTO.id) throw new ConnectorError('not_found', `There is no file ${fileId} in this conversation.`);
      return { info: PHOTO, data: new Uint8Array([1, 2, 3]) };
    },
  },
};

function demo() {
  const connector = createDemoConnector();
  const action = (name: string) => {
    const found = connector.actions.find((a) => a.name === name);
    if (!found) throw new Error(`The demo connector has no ${name}`);
    return found;
  };
  return { connector, action };
}

async function report(input: { date: string; site?: string }): Promise<{ result: Record<string, unknown>; file: ActionFile }> {
  const { result, files } = splitResult(await demo().action('get_pest_control_report').run(ctx, input));
  expect(files).toHaveLength(1);
  return { result: result as Record<string, unknown>, file: files[0]! };
}

it("hands over the day's pest control report as a PDF, the same one every time", async () => {
  const date = addDays(localDate(new Date(), 'UTC'), -1);
  const { result, file } = await report({ date });

  expect(file).toMatchObject({ filename: `pest-control-report-main-plant-${date}.pdf`, mimeType: 'application/pdf' });
  expect(Buffer.from(file.data.subarray(0, 5)).toString()).toBe('%PDF-');
  expect(result).toMatchObject({ reportNo: `PCR-${date.replaceAll('-', '')}-MP`, date, site: 'Main Plant', sampleData: true });
  expect(result.stationsChecked).toBeGreaterThan(0);

  const pdf = await PDFDocument.load(file.data, { updateMetadata: false });
  expect(pdf.getTitle()).toBe(`Daily Pest Control Report ${result.reportNo}`);
  expect(pdf.getKeywords()).toContain('sample data');
  const { text, totalPages } = await extractText(await getDocumentProxy(new Uint8Array(file.data)), { mergePages: true });
  expect(text).toContain('SAMPLE DATA – DEMO SYSTEM');
  expect(text).toContain(`Page ${totalPages} of ${totalPages}`);
  for (const heading of ['Stations and areas checked', 'Pests sighted', 'Chemicals used', 'Recommendations', 'Site supervisor']) expect(text).toContain(heading);

  expect(Buffer.from((await report({ date })).file.data).equals(Buffer.from(file.data))).toBe(true);
  const other = await report({ date, site: 'Warehouse B' });
  expect(other.file.filename).toBe(`pest-control-report-warehouse-b-${date}.pdf`);
  expect(other.result).toMatchObject({ reportNo: `PCR-${date.replaceAll('-', '')}-WB`, site: 'Warehouse B' });
});

it('needs a date, and has no report for a date that has not begun anywhere yet', async () => {
  const action = demo().action('get_pest_control_report');
  expect(action.description).toContain("if the person didn't say which day, ask them");
  for (const input of [{}, { date: '26/09/2026' }, { date: '2026-02-30' }]) expect(action.input.safeParse(input).success).toBe(false);

  const firstToday = localDate(new Date(), 'Pacific/Kiritimati');
  await expect(report({ date: firstToday })).resolves.toBeDefined();
  await expect(action.run(ctx, { date: addDays(firstToday, 1) })).rejects.toEqual(new ConnectorError('invalid_request', 'No report exists for a future date.'));
});

it('attaches a file from the conversation to a finding as evidence, once confirmed', async () => {
  const { connector, action } = demo();
  const attach = action('attach_evidence');
  expect(attach.kind).toBe('write');

  expect(await attach.describe({ findingId: 'F-101', fileId: PHOTO.id }, ctx)).toBe('Attach "exit.jpg" to finding F-101');
  await expect(attach.describe({ findingId: 'F-101', fileId: 'other' }, ctx)).rejects.toMatchObject({ kind: 'not_found' });

  const finding = await attach.run(ctx, { findingId: 'f-101', fileId: PHOTO.id, note: 'Pallets in front of the exit' });
  expect(finding).toMatchObject({ id: 'F-101', evidence: [{ fileId: PHOTO.id, filename: 'exit.jpg', note: 'Pallets in front of the exit' }] });
  expect(await action('list_findings').run(ctx, { status: 'open' })).toContainEqual(finding);
  await expect(attach.run(ctx, { findingId: 'F-999', fileId: PHOTO.id })).rejects.toMatchObject({ kind: 'not_found', message: 'There is no finding F-999.' });
  expect(connector.examples).toContain("Get yesterday's pest control report");
});
