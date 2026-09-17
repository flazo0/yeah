import { eq } from "drizzle-orm";
import { notificationChannels } from "@yeah/db";
import { sendNotification, type NotificationLevel } from "@yeah/notifications";
import type { NotificationEventType } from "@yeah/shared";
import { db } from "./db";

export async function notifyTeam(
  teamId: string,
  event: NotificationEventType,
  title: string,
  body: string,
  level: NotificationLevel,
): Promise<void> {
  const channels = await db.select().from(notificationChannels).where(eq(notificationChannels.teamId, teamId));
  await Promise.all(
    channels
      // null events = every type (backward-compatible default); otherwise only the listed ones.
      .filter((channel) => channel.enabled && (channel.events === null || channel.events.includes(event)))
      .map((channel) => sendNotification(channel, { title, body, level })),
  );
}
