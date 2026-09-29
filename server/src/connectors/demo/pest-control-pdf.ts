import { PageSizes, PDFDocument, rgb, StandardFonts, type Color, type PDFFont, type PDFPage } from '@cantoo/pdf-lib';
import type { PestControlReport } from './pest-control.ts';

const [WIDTH, HEIGHT] = PageSizes.A4;
const MARGIN = 42;
const CONTENT_WIDTH = WIDTH - 2 * MARGIN;
const FOOTER_SPACE = 40;
const SIZE = 9;
const LINE = SIZE * 1.3;
const PAD = 4;

const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.42, 0.42, 0.46);
const RULE = rgb(0.8, 0.8, 0.82);
const BRAND = rgb(0.13, 0.4, 0.31);
const STRIPE = rgb(0.95, 0.97, 0.96);
const SAMPLE_BACKGROUND = rgb(1, 0.95, 0.8);
const SAMPLE_INK = rgb(0.55, 0.36, 0);
const WHITE = rgb(1, 1, 1);

const SAMPLE = 'Sample data – demo system';

interface Column {
  label: string;
  /** Share of the table's width. */
  share: number;
}

/** The report as a PDF: A4 pages with the station table running on as long as it needs, and numbered pages. */
export async function pestControlPdf(report: PestControlReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  // The standard fonts can only write Western European characters, so anything else (such as a site named in Hindi)
  // is shown as "?" rather than failing.
  const known = new Set(regular.getCharacterSet());
  const clean = (text: string) =>
    Array.from(text.normalize('NFC').replace(/\s+/g, ' '), (c) => (known.has(c.codePointAt(0) ?? 0) ? c : '?')).join('');

  const title = `Daily Pest Control Report ${report.reportNo}`;
  // Dated from the report itself, so the same report always makes the same file.
  const writtenAt = new Date(`${report.date}T${report.timeOut}:00Z`);
  doc.setTitle(clean(title), { showInWindowTitleBar: true });
  doc.setAuthor(clean(`${report.inspector}, ${report.contractor}`));
  doc.setSubject(clean(`${report.company}, ${report.site}, ${report.date}. ${SAMPLE}.`));
  doc.setKeywords(['pest control', 'daily report', report.reportNo, clean(report.site), report.date, 'sample data']);
  doc.setCreator('Audit Assistant demo');
  doc.setProducer('Audit Assistant');
  doc.setLanguage('en');
  doc.setCreationDate(writtenAt);
  doc.setModificationDate(writtenAt);

  let page: PDFPage = doc.addPage([WIDTH, HEIGHT]);
  let y = HEIGHT - MARGIN;

  const write = (text: string, x: number, at: number, options: { font?: PDFFont; size?: number; color?: Color } = {}) =>
    page.drawText(clean(text), { x, y: at, size: options.size ?? SIZE, font: options.font ?? regular, color: options.color ?? INK });

  const newPage = () => {
    page = doc.addPage([WIDTH, HEIGHT]);
    y = HEIGHT - MARGIN;
    write(`${title} (continued)`, MARGIN, y - SIZE, { font: bold, color: MUTED });
    y -= 2 * LINE;
  };
  /** Starts a new page unless `height` more fits on this one. */
  const room = (height: number) => {
    if (y - height < MARGIN + FOOTER_SPACE) newPage();
  };

  const heading = (text: string) => {
    // Kept with the start of what follows it.
    room(8 * LINE);
    y -= LINE;
    write(text, MARGIN, y - 11, { font: bold, size: 11, color: BRAND });
    y -= 11 + LINE * 0.6;
  };

  const lines = (text: string, font: PDFFont, width: number) => wrap(clean(text), font, SIZE, width);

  const table = (columns: Column[], rows: string[][]) => {
    const widths = columns.map((column) => column.share * CONTENT_WIDTH);
    const layOut = (cells: string[], font: PDFFont) => {
      const wrapped = cells.map((cell, i) => lines(cell, font, (widths[i] ?? 0) - 2 * PAD));
      return { font, wrapped, height: Math.max(...wrapped.map((cell) => cell.length)) * LINE + 2 * PAD };
    };
    const draw = (row: ReturnType<typeof layOut>, fill: Color | null, color: Color) => {
      if (fill) page.drawRectangle({ x: MARGIN, y: y - row.height, width: CONTENT_WIDTH, height: row.height, color: fill });
      let x = MARGIN;
      row.wrapped.forEach((cell, i) => {
        cell.forEach((line, n) => page.drawText(line, { x: x + PAD, y: y - PAD - SIZE - n * LINE, size: SIZE, font: row.font, color }));
        x += widths[i] ?? 0;
      });
      y -= row.height;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_WIDTH, y }, thickness: 0.5, color: RULE });
    };
    const header = layOut(
      columns.map((column) => column.label),
      bold,
    );
    room(header.height + 2 * LINE);
    draw(header, BRAND, WHITE);
    rows.forEach((cells, i) => {
      const row = layOut(cells, regular);
      // A row that doesn't fit goes on the next page, under the column labels again.
      if (y - row.height < MARGIN + FOOTER_SPACE) {
        newPage();
        draw(header, BRAND, WHITE);
      }
      draw(row, i % 2 === 1 ? STRIPE : null, INK);
    });
  };

  // Header
  page.drawRectangle({ x: MARGIN, y: y - 20, width: CONTENT_WIDTH, height: 20, color: SAMPLE_BACKGROUND });
  write(`${SAMPLE.toUpperCase()}: not a real report`, MARGIN + PAD * 2, y - 14, { font: bold, color: SAMPLE_INK });
  y -= 44;
  write(report.company, MARGIN, y, { font: bold, size: 16 });
  y -= 20;
  write('Daily Pest Control Report', MARGIN, y, { font: bold, size: 13, color: BRAND });
  y -= 10;

  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${report.date}T12:00:00Z`),
  );
  const details: [string, string][] = [
    ['Report no.', report.reportNo],
    ['Date', day],
    ['Site', report.site],
    ['Contractor', report.contractor],
    ['Inspector', report.inspector],
    ['Time in / out', `${report.timeIn} to ${report.timeOut}`],
  ];
  details.forEach(([label, value], i) => {
    const x = MARGIN + (i % 2) * (CONTENT_WIDTH / 2);
    const at = y - LINE * 1.5 - Math.floor(i / 2) * LINE * 1.4;
    write(`${label}:`, x, at, { font: bold });
    write(value, x + 70, at);
  });
  y -= LINE * 1.5 + Math.ceil(details.length / 2) * LINE * 1.4;

  heading(`Stations and areas checked (${report.checks.length})`);
  table(
    [
      { label: '#', share: 0.05 },
      { label: 'Station', share: 0.09 },
      { label: 'Area', share: 0.17 },
      { label: 'Type', share: 0.19 },
      { label: 'Activity found', share: 0.24 },
      { label: 'Action taken', share: 0.26 },
    ],
    report.checks.map((check, i) => [String(i + 1), check.station, check.area, check.type, check.activity, check.action]),
  );

  heading('Pests sighted');
  if (report.sightings.length === 0) {
    room(LINE);
    write('None.', MARGIN, y - SIZE);
    y -= LINE;
  } else {
    table(
      [
        { label: 'Pest', share: 0.3 },
        { label: 'Count', share: 0.15 },
        { label: 'Where', share: 0.55 },
      ],
      report.sightings.map((sighting) => [sighting.pest, String(sighting.count), sighting.where]),
    );
  }

  heading('Chemicals used');
  table(
    [
      { label: 'Product', share: 0.4 },
      { label: 'Quantity', share: 0.25 },
      { label: 'Where applied', share: 0.35 },
    ],
    report.chemicals.map((chemical) => [chemical.product, chemical.quantity, chemical.where]),
  );

  heading('Recommendations');
  for (const recommendation of report.recommendations) {
    const wrapped = lines(recommendation, regular, CONTENT_WIDTH - 12);
    room(wrapped.length * LINE);
    write('•', MARGIN, y - SIZE);
    wrapped.forEach((line, n) => write(line, MARGIN + 12, y - SIZE - n * LINE));
    y -= wrapped.length * LINE + 3;
  }

  // Signatures
  room(70);
  y -= 50;
  for (const [i, label] of [`Inspector: ${report.inspector}`, 'Site supervisor'].entries()) {
    const x = MARGIN + i * (CONTENT_WIDTH / 2);
    page.drawLine({ start: { x, y }, end: { x: x + 180, y }, thickness: 0.7, color: INK });
    write(label, x, y - 12, { color: MUTED });
  }

  const pages = doc.getPages();
  pages.forEach((each, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const footer = `${SAMPLE} · Report ${report.reportNo}`;
    each.drawText(clean(footer), { x: MARGIN, y: MARGIN - 14, size: 7.5, font: regular, color: MUTED });
    each.drawText(label, { x: WIDTH - MARGIN - regular.widthOfTextAtSize(label, 7.5), y: MARGIN - 14, size: 7.5, font: regular, color: MUTED });
  });

  return doc.save();
}

/** Splits text into lines that fit `width`, breaking long words where they must. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const fits = (candidate: string) => font.widthOfTextAtSize(candidate, size) <= width;
  const result: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) result.push(line);
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
      result.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) result.push(line);
  return result.length > 0 ? result : [''];
}
