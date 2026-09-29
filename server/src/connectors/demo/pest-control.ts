import { createHash } from 'node:crypto';

/** A contractor's daily pest control report for one site. Made-up data for demo mode. */
export interface PestControlReport {
  reportNo: string;
  company: string;
  contractor: string;
  site: string;
  /** YYYY-MM-DD */
  date: string;
  inspector: string;
  /** HH:MM, local time at the site. */
  timeIn: string;
  timeOut: string;
  checks: StationCheck[];
  sightings: Sighting[];
  chemicals: ChemicalUse[];
  recommendations: string[];
}

export interface StationCheck {
  station: string;
  area: string;
  type: string;
  activity: string;
  action: string;
}

export interface Sighting {
  pest: string;
  count: number;
  where: string;
}

export interface ChemicalUse {
  product: string;
  quantity: string;
  where: string;
}

export const DEFAULT_SITE = 'Main Plant';

const AREAS = ['Loading bay', 'Raw material store', 'Production hall', 'Packing area', 'Finished goods store', 'Canteen', 'Scrap yard', 'Boundary wall', 'Office block', 'Utility room'];
const INSPECTORS = ['R. Sharma', 'A. Khan', 'P. Nair', 'S. Patel', 'M. Das'];

interface Outcome {
  activity: string;
  action: string;
  /** The pest the activity shows, if any. */
  pest?: string;
}

// What each kind of station can show, with what the inspector did about it. The first outcome is the quiet one.
const STATIONS: { prefix: string; type: string; outcomes: Outcome[] }[] = [
  {
    prefix: 'RB',
    type: 'Rodent bait station',
    outcomes: [
      { activity: 'No activity', action: 'Checked, bait intact' },
      { activity: 'Bait nibbled', action: 'Bait replenished', pest: 'Rodent' },
      { activity: 'Droppings found', action: 'Cleaned, bait replaced', pest: 'Rodent' },
    ],
  },
  {
    prefix: 'GB',
    type: 'Rodent glue board',
    outcomes: [
      { activity: 'No activity', action: 'Checked' },
      { activity: '1 mouse caught', action: 'Removed, board replaced', pest: 'Rodent' },
    ],
  },
  {
    prefix: 'IL',
    type: 'Insect light trap',
    outcomes: [
      { activity: 'Few flies on glue sheet', action: 'Glue sheet checked' },
      { activity: 'Glue sheet full of flies', action: 'Glue sheet replaced', pest: 'Housefly' },
    ],
  },
  {
    prefix: 'PT',
    type: 'Pheromone trap',
    outcomes: [
      { activity: 'No activity', action: 'Checked' },
      { activity: 'Stored-product moths caught', action: 'Lure replaced', pest: 'Stored-product moth' },
    ],
  },
  {
    prefix: 'DR',
    type: 'Drain',
    outcomes: [
      { activity: 'No activity', action: 'Drain cover checked' },
      { activity: 'Cockroaches seen', action: 'Gel bait applied, drain flushed', pest: 'Cockroach' },
    ],
  },
];

const CHEMICALS = [
  { product: 'Bromadiolone 0.005% wax block', quantity: (n: number) => `${n} blocks (${n * 20} g)`, pest: 'Rodent' },
  { product: 'Fipronil 0.05% gel', quantity: (n: number) => `${n * 5} g`, pest: 'Cockroach' },
  { product: 'Cypermethrin 10% EC', quantity: (n: number) => `${n * 25} ml in ${n * 2.5} L water`, pest: 'Housefly' },
  { product: 'Deltamethrin 2.5% WP', quantity: (n: number) => `${n * 10} g in ${n} L water`, pest: 'Stored-product moth' },
];

const ADVICE: Record<string, string> = {
  Rodent: 'Seal the gaps under the doors where rodent activity was found, and keep pallets 45 cm from the walls.',
  Cockroach: 'Fix the damaged drain covers and clear standing water around the drains.',
  Housefly: 'Keep the dock doors closed when not loading, and empty the waste bins twice a day.',
  'Stored-product moth': 'Rotate raw material stock first in, first out, and clean up spilled material.',
};
const ROUTINE_ADVICE = 'Keep the stations clear of stored goods so every one can be checked.';

/** The report for a date and site. The same date and site always give the same report. */
export function sampleReport(date: string, site: string): PestControlReport {
  const random = seeded(`${date}|${site.toLowerCase()}`);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const checks: StationCheck[] = [];
  const sightings = new Map<string, { count: number; areas: Set<string> }>();
  const stationCount = 14 + Math.floor(random() * 16);
  for (let n = 1; n <= stationCount; n++) {
    const kind = pick(STATIONS);
    const area = pick(AREAS);
    // Most stations show nothing on a given day.
    const outcome = random() < 0.7 ? kind.outcomes[0]! : pick(kind.outcomes);
    checks.push({ station: `${kind.prefix}-${String(n).padStart(2, '0')}`, area, type: kind.type, activity: outcome.activity, action: outcome.action });
    if (outcome.pest) {
      const seen = sightings.get(outcome.pest) ?? { count: 0, areas: new Set<string>() };
      seen.count += 1 + Math.floor(random() * 3);
      seen.areas.add(area);
      sightings.set(outcome.pest, seen);
    }
  }
  const where = (pest: string) => [...(sightings.get(pest)?.areas ?? [])].join(', ');

  const pests = new Set(sightings.keys());
  const chemicals = CHEMICALS.filter((chemical) => pests.has(chemical.pest) || chemical.pest === 'Rodent').map((chemical) => ({
    product: chemical.product,
    quantity: chemical.quantity(2 + Math.floor(random() * 5)),
    where: where(chemical.pest) || 'Bait stations, routine top-up',
  }));

  const startMinutes = 7 * 60 + Math.floor(random() * 8) * 15;
  const endMinutes = startMinutes + 60 + stationCount * 5;
  return {
    reportNo: `PCR-${date.replaceAll('-', '')}-${siteCode(site)}`,
    company: 'Demo Manufacturing Ltd.',
    contractor: 'Acme Pest Control (sample contractor)',
    site,
    date,
    inspector: pick(INSPECTORS),
    timeIn: clock(startMinutes),
    timeOut: clock(endMinutes),
    checks,
    sightings: [...sightings].map(([pest, { count }]) => ({ pest, count, where: where(pest) })),
    chemicals,
    recommendations: [...[...pests].map((pest) => ADVICE[pest] ?? ROUTINE_ADVICE), ROUTINE_ADVICE],
  };
}

/** e.g. pest-control-report-main-plant-2026-09-26.pdf */
export function reportFilename(report: PestControlReport): string {
  const slug = report.site
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `pest-control-report-${slug || 'site'}-${report.date}.pdf`;
}

/** Initials of the site's words, e.g. "MP" for Main Plant. */
function siteCode(site: string): string {
  return (
    site
      .split(/\s+/)
      .map((word) => word.normalize('NFKD').replace(/[^a-z0-9]/gi, '').charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 4) || 'X'
  );
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A repeatable stream of numbers from 0 to 1 (mulberry32), seeded from text. */
function seeded(text: string): () => number {
  let state = createHash('sha256').update(text).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
