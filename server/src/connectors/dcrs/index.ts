import type { Connector } from '../types.ts';
import { dcrsClient, tokenOf, type DcrsOptions } from './client.ts';
import { documentActions } from './documents.ts';
import { findingActions } from './findings.ts';
import { plantActions } from './plant.ts';
import { recordActions } from './records.ts';

/**
 * The Digital Controlled Record System, through its API for the mobile app (/api/v1; DCRS's
 * docs/chatbot-integration.md). People sign in with their DCRS email and password, and every action runs with their
 * own DCRS session: DCRS applies its own department rules, working hours, validation and record lifecycle, and writes
 * each change in the record's history and its activity log as "Through Mitra mobile app". Lookups run at once;
 * changes wait for the person to confirm them, which the framework does for every action of kind "write".
 *
 * Not offered, as in DCRS's hand-off: moving around DCRS's own pages (navigate), the question-by-question fill
 * (start_guided_fill) and Mitra's ask_user (the chat itself does these), reading attachments (the app reads them
 * itself), and changing a document's format (a design task for DCRS on a desktop).
 */
export function createDcrsConnector(options: DcrsOptions): Connector {
  const dcrs = dcrsClient(options);
  return {
    id: 'dcrs',
    name: 'Digital Controlled Record System',
    description:
      "The plant's controlled documents (formats such as F/QC/05 or F/HR/17), the records filled in on them, CAPA findings, customer complaints and the daily pest control report, with the person's own DCRS account and departments. Dates are the factory's days, YYYY-MM-DD. To fill in a record: find_documents, open_record, get_record for its field keys, edit_record, then record_action submit.",
    examples: ['What is due today?', "Start today's pest control record", 'Show the open CAPA findings', "Print yesterday's pest control report"],
    actions: [...documentActions(dcrs), ...plantActions(dcrs), ...recordActions(dcrs), ...findingActions(dcrs)],
    authenticate: (username, password) => dcrs.signIn(username.trim(), password),
    signOut: async (credentials) => dcrs.signOut(tokenOf(credentials)),
  };
}
