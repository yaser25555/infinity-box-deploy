import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  playerId: text("player_id").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  avatar: text("avatar"),
  profileImage: text("profile_image"), // رابط الصورة الشخصية
  gender: varchar("gender", { length: 10 }).default("male"), // male, female
  isAdmin: boolean("is_admin").default(false),
  coins: integer("coins").default(0),
  goldCoins: integer("gold_coins").default(10000),
  pearls: integer("pearls").default(10),
  level: integer("level").default(1),
  experience: integer("experience").default(0),
  joinedAt: timestamp("joined_at").defaultNow(),
  lastActive: timestamp("last_active").defaultNow(),
  status: text("status").default("offline"),
  activeSessionToken: text("active_session_token"), // للتحكم في الجلسات المتعددة
});

// Game scores table
export const gameScores = pgTable("game_scores", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  gameName: text("game_name").notNull(),
  score: integer("score").notNull(),
  level: integer("level").default(1),
  playedAt: timestamp("played_at").defaultNow(),
});

// Game achievements table
export const achievements = pgTable("achievements", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  achievementName: text("achievement_name").notNull(),
  description: text("description"),
  unlockedAt: timestamp("unlocked_at").defaultNow(),
});

// نظام الأصدقاء
export const friendships = pgTable("friendships", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  friendId: integer("friend_id").notNull().references(() => users.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, accepted, blocked
  createdAt: timestamp("created_at").defaultNow(),
  acceptedAt: timestamp("accepted_at"),
});

// نظام الهدايا
export const gifts = pgTable("gifts", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull().references(() => users.id),
  toUserId: integer("to_user_id").notNull().references(() => users.id),
  giftType: varchar("gift_type", { length: 50 }).notNull(), // gold, pearls, shield, energy
  amount: integer("amount").notNull(),
  message: text("message"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, claimed, expired
  sentAt: timestamp("sent_at").defaultNow(),
  claimedAt: timestamp("claimed_at"),
});

// نظام الرسائل الخاصة
export const privateMessages = pgTable("private_messages", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id").notNull().references(() => users.id),
  toUserId: integer("to_user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  isRead: boolean("is_read").default(false),
  sentAt: timestamp("sent_at").defaultNow(),
});

// نظام الدروع والعناصر
export const userItems = pgTable("user_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  itemType: varchar("item_type", { length: 50 }).notNull(), // shield, energy_boost, score_multiplier
  itemName: varchar("item_name", { length: 100 }).notNull(),
  quantity: integer("quantity").default(1),
  isActive: boolean("is_active").default(false),
  expiresAt: timestamp("expires_at"),
  obtainedAt: timestamp("obtained_at").defaultNow(),
});

// معاملات شحن الرصيد
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  transactionType: varchar("transaction_type", { length: 50 }).notNull(), // purchase, gift_sent, gift_received, game_reward
  goldAmount: integer("gold_amount").default(0),
  pearlsAmount: integer("pearls_amount").default(0),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userShields = pgTable("user_shields", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  shieldType: varchar("shield_type", { length: 20 }).notNull(), // 'gold' or 'usd'
  activatedAt: timestamp("activated_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  isActive: boolean("is_active").default(true),
  cost: integer("cost").notNull(), // المبلغ المدفوع
  currency: varchar("currency", { length: 10 }).notNull() // 'gold' or 'usd'
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type LoginData = z.infer<typeof loginSchema>;
export type GameScore = typeof gameScores.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;
export type Gift = typeof gifts.$inferSelect;
export type PrivateMessage = typeof privateMessages.$inferSelect;
export type UserItem = typeof userItems.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type UserShield = typeof userShields.$inferSelect;