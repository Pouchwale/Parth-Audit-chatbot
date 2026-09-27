import type { ConversationSummary } from '@shared/api';

export interface ConversationSection {
  title: string;
  data: ConversationSummary[];
}

/** Each group starts at midnight this many days ago; anything earlier is "Older". */
const GROUPS = [
  { title: 'Today', daysAgo: 0 },
  { title: 'Yesterday', daysAgo: 1 },
  { title: 'Previous 7 days', daysAgo: 7 },
  { title: 'Previous 30 days', daysAgo: 30 },
] as const;

/** Groups conversations (already newest first) by when they were last updated, in local time. */
export function sectionsByDate(conversations: ConversationSummary[], now = new Date()): ConversationSection[] {
  const starts = GROUPS.map(({ daysAgo }) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo).getTime());
  const sections: ConversationSection[] = [...GROUPS.map(({ title }) => ({ title, data: [] })), { title: 'Older', data: [] }];
  for (const conversation of conversations) {
    const updatedAt = Date.parse(conversation.updatedAt);
    const group = starts.findIndex((start) => updatedAt >= start);
    sections[group === -1 ? GROUPS.length : group].data.push(conversation);
  }
  return sections.filter((section) => section.data.length > 0);
}

/** Conversations whose title or preview contains the query, ignoring case. */
export function searchConversations(conversations: ConversationSummary[], query: string): ConversationSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return conversations;
  return conversations.filter((conversation) =>
    [conversation.title, conversation.preview].some((text) => text?.toLowerCase().includes(needle)),
  );
}
