import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(),
  nickname: text('nickname').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const requests = sqliteTable('requests', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => profiles.userId),
  title: text('title').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull(),
  region: text('region').notNull(),
  preferredTime: text('preferred_time').notNull(),
  budget: integer('budget').notNull(),
  targetPeople: integer('target_people').notNull(),
  deadline: integer('deadline').notNull(),
  status: text('status').notNull().default('open'),
  selectedProposalId: text('selected_proposal_id'),
  cancellationReason: text('cancellation_reason'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('requests_created_idx').on(table.createdAt),
  index('requests_owner_idx').on(table.ownerId),
  check('requests_budget_nonnegative', sql`${table.budget} >= 0`),
  check('requests_target_range', sql`${table.targetPeople} BETWEEN 2 AND 30`),
  check('requests_status_allowed', sql`${table.status} IN ('open', 'confirming', 'completed', 'cancelled')`),
]);

export const interests = sqliteTable('interests', {
  requestId: text('request_id').notNull().references(() => requests.id),
  userId: text('user_id').notNull().references(() => profiles.userId),
  createdAt: integer('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.requestId, table.userId] })]);

export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => requests.id),
  ownerId: text('owner_id').notNull().references(() => profiles.userId),
  providerName: text('provider_name').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  price: integer('price').notNull(),
  startsAt: integer('starts_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  location: text('location').notNull(),
  minParticipants: integer('min_participants').notNull(),
  capacity: integer('capacity').notNull(),
  bookingUrl: text('booking_url').notNull().default(''),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  uniqueIndex('proposals_request_provider_unique').on(table.requestId, table.ownerId),
  check('proposals_price_nonnegative', sql`${table.price} >= 0`),
  check('proposals_capacity_range', sql`${table.capacity} BETWEEN 2 AND 30`),
  check('proposals_minimum_range', sql`${table.minParticipants} BETWEEN 1 AND ${table.capacity}`),
  check('proposals_duration_range', sql`${table.durationMinutes} BETWEEN 15 AND 720`),
]);

export const registrations = sqliteTable('registrations', {
  requestId: text('request_id').notNull().references(() => requests.id),
  userId: text('user_id').notNull().references(() => profiles.userId),
  proposalId: text('proposal_id').notNull().references(() => proposals.id),
  createdAt: integer('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.requestId, table.userId] })]);
