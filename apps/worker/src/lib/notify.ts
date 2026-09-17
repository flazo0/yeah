import { eq } from "drizzle-orm";
import { notificationChannels } from "@yeah/db";
import { sendNotification, type NotificationLevel } from "@yeah/notifications";
import { db } from "./db";

export async function notifyTeam(teamId: string, title: string, body: string, level: NotificationLevel): Promise<void> {
  const channels = await db.select().from(notificationChannels).where(eq(notificationChannels.teamId, teamId));
  await Promise.all(
    channels.filter((channel) => channel.enabled).map((channel) => sendNotification(channel, { title, body, level })),
  );
}
