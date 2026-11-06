// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
export {};
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const borderDays = sqliteTable("border_days", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  close: text("close_time").notNull(),
  ranksJson: text("ranks_json").notNull(),
  sourceUrl: text("source_url").notNull(),
  checkedAt: text("checked_at").notNull(),
});

export const borderSync = sqliteTable("border_sync", {
  id: text("id").primaryKey(),
  lastAttempt: text("last_attempt").notNull().default(""),
  lastSuccess: text("last_success").notNull().default(""),
  status: text("status").notNull().default("pending"),
  message: text("message").notNull().default(""),
  lockUntil: integer("lock_until").notNull().default(0),
});

// Page-open observations; owner-only statistics. Nullable detail columns keep
// previously recorded events unmeasured instead of inventing historical data.
export const siteVisitEvents = sqliteTable("site_visit_events", {
  eventId: text("event_id").primaryKey(),
  day: text("day").notNull(),
  visitorHash: text("visitor_hash").notNull(),
  occurredAt: text("occurred_at"),
  ipAddress: text("ip_address"),
  country: text("country"),
  region: text("region"),
  city: text("city"),
  deviceType: text("device_type"),
  deviceModel: text("device_model"),
  osFamily: text("os_family"),
  osVersion: text("os_version"),
  browserFamily: text("browser_family"),
  browserVersion: text("browser_version"),
}, table => [index("idx_site_visit_events_day_visitor").on(table.day, table.visitorHash), index("idx_site_visit_events_day_time").on(table.day, table.occurredAt)]);

// Inquiries are separate from analytics. Only the capability hash is stored;
// public visitors can read their own conversations, the owner can reply.
export const contactThreads = sqliteTable("contact_threads", {
  id: text("id").primaryKey(),
  visitorHash: text("visitor_hash").notNull(),
  subject: text("subject").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [index("idx_contact_threads_visitor_updated").on(table.visitorHash, table.updatedAt), index("idx_contact_threads_updated").on(table.updatedAt)]);

export const contactMessages = sqliteTable("contact_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull().references(() => contactThreads.id),
  author: text("author").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  attachmentKey: text("attachment_key"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  attachmentHash: text("attachment_hash"),
  attachmentsJson: text("attachments_json"),
}, table => [index("idx_contact_messages_thread_time").on(table.threadId, table.createdAt)]);

export const securityRateWindows = sqliteTable("security_rate_windows", {
  id:text("id").primaryKey(),
  expiresAt:integer("expires_at").notNull(),
  hits:integer("hits").notNull(),
},table=>[index("idx_security_rate_expiry").on(table.expiresAt)]);

// Fixed server-side lifetime for contact capabilities. Keep revocation tombstones
// so a historical cookie can never regain access through legacy adoption.
export const contactSessions = sqliteTable("contact_sessions", {
  visitorHash: text("visitor_hash").primaryKey(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
});
