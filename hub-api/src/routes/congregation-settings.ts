/**
 * Congregation settings routes — language, meeting times, preferences.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";

const SettingsBody = Type.Object({
  language: Type.Optional(Type.String({ minLength: 2, maxLength: 10 })),
  jwLanguageCode: Type.Optional(Type.String({ minLength: 1, maxLength: 10 })),
  defaultMidweekDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
  defaultMidweekTime: Type.Optional(Type.String({ pattern: "^\\d{2}:\\d{2}$" })),
  defaultWeekendDay: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
  defaultWeekendTime: Type.Optional(Type.String({ pattern: "^\\d{2}:\\d{2}$" })),
  defaultLocation: Type.Optional(Type.String()),
});
type SettingsBodyType = Static<typeof SettingsBody>;

export async function congregationSettingsRoutes(app: FastifyInstance): Promise<void> {
  // Get congregation settings
  app.get(
    "/congregation-settings",
    { preHandler: requirePermission(PERMISSIONS.SETTINGS_VIEW) },
    async () => {
      let settings = await prisma.congregationSettings.findFirst();
      if (!settings) {
        settings = await prisma.congregationSettings.create({ data: {} });
      }
      return settings;
    },
  );

  // Update congregation settings
  app.put<{ Body: SettingsBodyType }>(
    "/congregation-settings",
    {
      preHandler: requirePermission(PERMISSIONS.SETTINGS_EDIT),
      schema: { body: SettingsBody },
    },
    async (request) => {
      let settings = await prisma.congregationSettings.findFirst();
      if (!settings) {
        settings = await prisma.congregationSettings.create({ data: request.body });
      } else {
        settings = await prisma.congregationSettings.update({
          where: { id: settings.id },
          data: request.body,
        });
      }
      return settings;
    },
  );
}
