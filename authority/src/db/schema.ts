import { pgTable, text, timestamp, uuid, index, jsonb } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    googleSub: text('google_sub').unique().notNull(),
    name: text('name'),
    profileImage: text('profile_image'),
    isAdmin: text('is_admin').default('false'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    googleSubIdx: index('idx_users_google_sub').on(table.googleSub),
  }),
)

export const servers = pgTable(
  'servers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverName: text('server_name').unique().notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpointType: text('endpoint_type'), // 'http', 'ws', 'webrtc', etc.
    address: text('address'), // URL or host:port
    metadata: jsonb('metadata'), // Optional extra info
    lastUpdated: timestamp('last_updated', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    ownerIdIdx: index('idx_servers_owner_id').on(table.ownerId),
    serverNameIdx: index('idx_servers_server_name').on(table.serverName),
    endpointTypeIdx: index('idx_servers_endpoint_type').on(table.endpointType),
  }),
)

export const namespaceRequests = pgTable(
  'namespace_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestedOrigin: text('requested_origin').notNull(),
    requestedNamespace: text('requested_namespace').notNull(),
    status: text('status').notNull().default('pending'), // pending, approved, rejected
    rejectionReason: text('rejection_reason'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    metadata: jsonb('metadata'), // contact info, use case, etc.
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    requesterIdIdx: index('idx_namespace_requests_requester_id').on(table.requesterId),
    statusIdx: index('idx_namespace_requests_status').on(table.status),
    namespaceIdx: index('idx_namespace_requests_namespace').on(table.requestedOrigin, table.requestedNamespace),
  }),
)

export const serverNames = pgTable(
  'server_names',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serverName: text('server_name').unique().notNull(),
    origin: text('origin').notNull().default(''),
    namespace: text('namespace').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    serverNameIdx: index('idx_server_names_server_name').on(table.serverName),
    ownerIdIdx: index('idx_server_names_owner_id').on(table.ownerId),
    namespaceIdx: index('idx_server_names_namespace').on(table.origin, table.namespace),
  }),
)

export const serverNamesRelations = relations(serverNames, ({ one }) => ({
  owner: one(users, {
    fields: [serverNames.ownerId],
    references: [users.id],
  }),
}))

export const namespaceAuthorizations = pgTable(
  'namespace_authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    origin: text('origin').notNull(),
    namespace: text('namespace').notNull(),
    subpath: text('subpath').notNull().default(''),
    authorizedEmail: text('authorized_email').notNull(),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    namespaceIdx: index('idx_namespace_authorizations_namespace').on(table.origin, table.namespace),
    scopeIdx: index('idx_namespace_authorizations_scope').on(table.origin, table.namespace, table.subpath),
    emailIdx: index('idx_namespace_authorizations_email').on(table.authorizedEmail),
  }),
)

export const usersRelations = relations(users, ({ many }) => ({
  servers: many(servers),
  namespaceRequests: many(namespaceRequests),
  namespaceAuthorizations: many(namespaceAuthorizations),
  approvalsGiven: many(namespaceRequests, {
    relationName: 'approver',
  }),
}))

export const serversRelations = relations(servers, ({ one }) => ({
  owner: one(users, {
    fields: [servers.ownerId],
    references: [users.id],
  }),
}))

export const namespaceRequestsRelations = relations(namespaceRequests, ({ one }) => ({
  requester: one(users, {
    fields: [namespaceRequests.requesterId],
    references: [users.id],
    relationName: 'requester',
  }),
  approver: one(users, {
    fields: [namespaceRequests.approvedBy],
    references: [users.id],
    relationName: 'approver',
  }),
}))

export const namespaceAuthorizationsRelations = relations(namespaceAuthorizations, ({ one }) => ({
  addedBy: one(users, {
    fields: [namespaceAuthorizations.addedBy],
    references: [users.id],
  }),
}))

