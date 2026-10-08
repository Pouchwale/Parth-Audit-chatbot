import type { PhoneRelay } from '../types.ts';
import { tokenOf, type DcrsClient } from './client.ts';
import { segment } from './inputs.ts';

/**
 * The phone's inbox, tasks and Review screen, relayed to DCRS's /api/v1 as the signed-in person (DCRS's
 * docs/chatbot-integration.md, "Notification contract changes"). DCRS keeps the notification ledger, sends the push
 * alerts, works out the tasks and checks every value and every level of access; this only carries the person's own
 * DCRS sign-in there and back, with the header X-Client-Name: Mitra mobile app, so a change shows in the record's
 * history as "Through Mitra mobile app". A refusal comes back as a ConnectorError in DCRS's words (client.ts refusalOf).
 */
export function phoneRelay(dcrs: DcrsClient): PhoneRelay {
  const as = (credentials: unknown) => ({ token: tokenOf(credentials) });
  return {
    notifications: (credentials, query) => dcrs.json('GET', '/api/v1/notifications', { ...as(credentials), query }),
    markRead: (credentials, body) => dcrs.json('POST', '/api/v1/notifications/read', { ...as(credentials), body }),
    testNotification: (credentials) => dcrs.json('POST', '/api/v1/notifications/test', { ...as(credentials), body: {} }),
    preferences: (credentials) => dcrs.json('GET', '/api/v1/notification-preferences', as(credentials)),
    savePreferences: (credentials, body) => dcrs.json('PUT', '/api/v1/notification-preferences', { ...as(credentials), body }),
    registerDevice: (credentials, body) => dcrs.json('POST', '/api/v1/devices', { ...as(credentials), body }),
    removeDevice: (credentials, body) => dcrs.json('DELETE', '/api/v1/devices', { ...as(credentials), body }),
    tasks: (credentials) => dcrs.json('GET', '/api/v1/today', as(credentials)),
    startRecord: (credentials, body) => dcrs.json('POST', '/api/v1/records', { ...as(credentials), body }),
    record: (credentials, recordId) => dcrs.json('GET', `/api/v1/records/${segment(recordId)}`, as(credentials)),
    changeRecord: (credentials, recordId, body) => dcrs.json('POST', `/api/v1/records/${segment(recordId)}/changes`, { ...as(credentials), body }),
    actOnRecord: (credentials, recordId, body) => dcrs.json('POST', `/api/v1/records/${segment(recordId)}/actions`, { ...as(credentials), body }),
  };
}
