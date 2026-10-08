import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("voice_settings", {
  userId: text("user_id").primaryKey(),
  encryptedKey: text("encrypted_key"),
  defaultVoice: text("default_voice").notNull().default(""),
  model: text("model").notNull().default("s2.1-pro-free"),
  updatedAt: text("updated_at").notNull(),
});

export const voiceovers = sqliteTable("voiceovers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  requestId: text("request_id").notNull(),
  title: text("title").notNull(),
  text: text("script").notNull(),
  voiceId: text("voice_id").notNull(),
  model: text("model").notNull(),
  speed: real("speed").notNull(),
  status: text("status").notNull(),
  objectKey: text("object_key"),
  bytes: integer("bytes"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  uniqueIndex("voiceovers_request_unique").on(table.userId, table.requestId),
  index("voiceovers_user_created").on(table.userId, table.createdAt),
]);
