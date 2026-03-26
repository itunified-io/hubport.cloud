/**
 * Speaker directory routes — local, manual, and hubport speakers.
 * Includes talk assignment and CSV import for manual guest speakers.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit, buildContext } from "../lib/policy-engine.js";
import prisma from "../lib/prisma.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const SpeakerBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  congregationName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  isLocal: Type.Optional(Type.Boolean()),
  source: Type.Optional(Type.Union([Type.Literal("local"), Type.Literal("manual"), Type.Literal("hubport")])),
  status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("inactive")])),
  monthlyInviteCap: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
  sharePhone: Type.Optional(Type.Boolean()),
  shareEmail: Type.Optional(Type.Boolean()),
  shareAvailability: Type.Optional(Type.Boolean()),
  notes: Type.Optional(Type.String()),
  talkNumbers: Type.Optional(Type.Array(Type.Integer())),
});
type SpeakerBodyType = Static<typeof SpeakerBody>;

export async function speakerRoutes(app: FastifyInstance): Promise<void> {
  // List speakers (with talks included)
  app.get(
    "/speakers",
    { preHandler: requirePermission(PERMISSIONS.SPEAKERS_VIEW) },
    async (request) => {
      const { isLocal, status, source } = request.query as { isLocal?: string; status?: string; source?: string };
      const where: Record<string, unknown> = {};
      if (isLocal !== undefined) where.isLocal = isLocal === "true";
      if (status) where.status = status;
      if (source) where.source = source;

      return prisma.speaker.findMany({
        where,
        include: {
          talks: { include: { publicTalk: { select: { talkNumber: true, title: true } } } },
          _count: { select: { schedules: true } },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
    },
  );

  // Get speaker (with talks and schedules)
  app.get<{ Params: IdParamsType }>(
    "/speakers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SPEAKERS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const speaker = await prisma.speaker.findUnique({
        where: { id: request.params.id },
        include: {
          talks: { include: { publicTalk: true } },
          schedules: {
            include: {
              publicTalk: true,
              meeting: { select: { id: true, date: true, title: true } },
            },
            orderBy: { meeting: { date: "desc" } },
          },
        },
      });
      if (!speaker) return reply.code(404).send({ error: "Speaker not found" });
      return speaker;
    },
  );

  // Create speaker (with optional talk numbers)
  app.post<{ Body: SpeakerBodyType }>(
    "/speakers",
    {
      preHandler: requirePermission(PERMISSIONS.SPEAKERS_EDIT),
      schema: { body: SpeakerBody },
    },
    async (request, reply) => {
      const { talkNumbers, ...speakerData } = request.body;
      const actorId = (request as any).publisherId ?? (request as any).userId;

      // Set source based on isLocal if not explicitly provided
      if (!speakerData.source) {
        speakerData.source = speakerData.isLocal === false ? "manual" : "local";
      }

      const speaker = await prisma.speaker.create({
        data: speakerData as any,
      });

      // Link talk numbers if provided
      if (talkNumbers?.length) {
        const talks = await prisma.publicTalk.findMany({
          where: { talkNumber: { in: talkNumbers } },
          select: { id: true },
        });
        if (talks.length > 0) {
          await prisma.speakerTalk.createMany({
            data: talks.map((t: { id: string }) => ({ speakerId: speaker.id, publicTalkId: t.id })),
            skipDuplicates: true,
          });
        }
      }

      await audit(actorId, "speaker.create", speaker.id, `${speakerData.firstName} ${speakerData.lastName}`);

      // Return with talks included
      return reply.code(201).send(
        await prisma.speaker.findUnique({
          where: { id: speaker.id },
          include: { talks: { include: { publicTalk: { select: { talkNumber: true, title: true } } } } },
        }),
      );
    },
  );

  // Update speaker (with optional talk numbers sync)
  app.put<{ Params: IdParamsType; Body: SpeakerBodyType }>(
    "/speakers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SPEAKERS_EDIT),
      schema: { params: IdParams, body: SpeakerBody },
    },
    async (request, reply) => {
      const { talkNumbers, ...speakerData } = request.body;
      const existing = await prisma.speaker.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: "Speaker not found" });

      await prisma.speaker.update({ where: { id: request.params.id }, data: speakerData as any });

      // Sync talk numbers if provided
      if (talkNumbers !== undefined) {
        // Delete old links
        await prisma.speakerTalk.deleteMany({ where: { speakerId: request.params.id } });

        // Create new links
        if (talkNumbers.length > 0) {
          const talks = await prisma.publicTalk.findMany({
            where: { talkNumber: { in: talkNumbers } },
            select: { id: true },
          });
          if (talks.length > 0) {
            await prisma.speakerTalk.createMany({
              data: talks.map((t: { id: string }) => ({ speakerId: request.params.id, publicTalkId: t.id })),
              skipDuplicates: true,
            });
          }
        }
      }

      return prisma.speaker.findUnique({
        where: { id: request.params.id },
        include: { talks: { include: { publicTalk: { select: { talkNumber: true, title: true } } } } },
      });
    },
  );

  // ─── Speaker Self-Service ────────────────────────────────────────────

  // GET /speakers/me — get own speaker profile + talks (auto-provisions if user has privilege:publicTalk)
  app.get(
    "/speakers/me",
    async (request, reply) => {
      const sub = (request as any).user?.sub;
      if (!sub) return reply.code(401).send({ error: "Not authenticated" });

      // Check if user has the publicTalk privilege via policy engine
      const ctx = await buildContext(request as unknown as FastifyRequest);
      const hasPublicTalkRole = ctx.effectivePermissions.includes(PERMISSIONS.PRIVILEGE_PUBLIC_TALK)
        || ctx.effectivePermissions.includes(PERMISSIONS.WILDCARD);
      if (!hasPublicTalkRole) return reply.code(403).send({ error: "Public Talk role required" });

      const publisher = await prisma.publisher.findFirst({
        where: { keycloakSub: sub },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });

      // Find existing speaker or auto-provision
      let speaker = await prisma.speaker.findFirst({
        where: { publisherId: publisher.id },
        include: {
          talks: { include: { publicTalk: { select: { id: true, talkNumber: true, title: true } } } },
        },
      });

      if (!speaker) {
        // Auto-create Speaker for users with publicTalk privilege
        speaker = await prisma.speaker.create({
          data: {
            firstName: publisher.firstName || "",
            lastName: publisher.lastName || "",
            publisherId: publisher.id,
            isLocal: true,
            source: "local",
            status: "active",
          },
          include: {
            talks: { include: { publicTalk: { select: { id: true, talkNumber: true, title: true } } } },
          },
        });
      }

      return speaker;
    },
  );

  // PUT /speakers/me/talks — update own talk list
  app.put(
    "/speakers/me/talks",
    async (request, reply) => {
      const sub = (request as any).user?.sub;
      if (!sub) return reply.code(401).send({ error: "Not authenticated" });

      const body = request.body as { talkNumbers: number[] };
      if (!Array.isArray(body.talkNumbers)) {
        return reply.code(400).send({ error: "talkNumbers array required" });
      }

      const publisher = await prisma.publisher.findFirst({ where: { keycloakSub: sub }, select: { id: true } });
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });

      const speaker = await prisma.speaker.findFirst({ where: { publisherId: publisher.id }, select: { id: true } });
      if (!speaker) return reply.code(404).send({ error: "No speaker profile linked" });

      // Sync talks: delete old, create new
      await prisma.speakerTalk.deleteMany({ where: { speakerId: speaker.id } });

      if (body.talkNumbers.length > 0) {
        const talks = await prisma.publicTalk.findMany({
          where: { talkNumber: { in: body.talkNumbers } },
          select: { id: true },
        });
        if (talks.length > 0) {
          await prisma.speakerTalk.createMany({
            data: talks.map((t: { id: string }) => ({ speakerId: speaker.id, publicTalkId: t.id })),
            skipDuplicates: true,
          });
        }
      }

      return prisma.speaker.findUnique({
        where: { id: speaker.id },
        include: { talks: { include: { publicTalk: { select: { id: true, talkNumber: true, title: true } } } } },
      });
    },
  );

  // PUT /speakers/me/talks/:talkId/mute — toggle muted state for a talk
  app.put(
    "/speakers/me/talks/:talkId/mute",
    async (request, reply) => {
      const sub = (request as any).user?.sub;
      if (!sub) return reply.code(401).send({ error: "Not authenticated" });

      const { talkId } = request.params as { talkId: string };

      const publisher = await prisma.publisher.findFirst({ where: { keycloakSub: sub }, select: { id: true } });
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });

      const speaker = await prisma.speaker.findFirst({ where: { publisherId: publisher.id }, select: { id: true } });
      if (!speaker) return reply.code(404).send({ error: "No speaker profile linked" });

      const speakerTalk = await prisma.speakerTalk.findFirst({
        where: { id: talkId, speakerId: speaker.id },
      });
      if (!speakerTalk) return reply.code(404).send({ error: "Talk not found" });

      const updated = await prisma.speakerTalk.update({
        where: { id: talkId },
        data: { muted: !speakerTalk.muted },
        include: { publicTalk: { select: { id: true, talkNumber: true, title: true } } },
      });

      return updated;
    },
  );

  // PUT /speakers/me/sharing — update own sharing preferences
  app.put(
    "/speakers/me/sharing",
    async (request, reply) => {
      const sub = (request as any).user?.sub;
      if (!sub) return reply.code(401).send({ error: "Not authenticated" });

      const body = request.body as {
        sharePhone?: boolean;
        shareEmail?: boolean;
        shareAvailability?: boolean;
        monthlyInviteCap?: number;
      };

      const publisher = await prisma.publisher.findFirst({ where: { keycloakSub: sub }, select: { id: true } });
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });

      const speaker = await prisma.speaker.findFirst({ where: { publisherId: publisher.id }, select: { id: true } });
      if (!speaker) return reply.code(404).send({ error: "No speaker profile linked" });

      const data: Record<string, unknown> = {};
      if (body.sharePhone !== undefined) data.sharePhone = body.sharePhone;
      if (body.shareEmail !== undefined) data.shareEmail = body.shareEmail;
      if (body.shareAvailability !== undefined) data.shareAvailability = body.shareAvailability;
      if (body.monthlyInviteCap !== undefined) {
        const cap = Math.max(1, Math.min(12, body.monthlyInviteCap));
        data.monthlyInviteCap = cap;
      }

      const updated = await prisma.speaker.update({
        where: { id: speaker.id },
        data,
        select: { sharePhone: true, shareEmail: true, shareAvailability: true, monthlyInviteCap: true },
      });

      return updated;
    },
  );

  // POST /speakers/import-csv — bulk import manual speakers from CSV text
  app.post(
    "/speakers/import-csv",
    { preHandler: requirePermission(PERMISSIONS.SPEAKERS_EDIT) },
    async (request, reply) => {
      const { csv } = request.body as { csv: string };
      if (!csv?.trim()) return reply.code(400).send({ error: "No CSV data" });

      const actorId = (request as any).publisherId ?? (request as any).userId;
      const lines = csv.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      const results: { line: number; name?: string; error?: string }[] = [];
      let imported = 0;

      for (let i = 0; i < lines.length; i++) {
        try {
          // Parse: firstName, lastName, congregation, phone, email, "talkNumbers"
          const parts = parseCSVLine(lines[i]);
          if (parts.length < 2) {
            results.push({ line: i + 1, error: "Need at least firstName, lastName" });
            continue;
          }

          const [firstName, lastName, congregationName, phone, email, talkNumbersStr] = parts;
          const talkNums = talkNumbersStr
            ? talkNumbersStr.split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n))
            : [];

          const speaker = await prisma.speaker.create({
            data: {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              congregationName: congregationName?.trim() || null,
              phone: phone?.trim() || null,
              email: email?.trim() || null,
              isLocal: false,
              source: "manual",
              status: "active",
            },
          });

          // Link talks
          if (talkNums.length > 0) {
            const talks = await prisma.publicTalk.findMany({
              where: { talkNumber: { in: talkNums } },
              select: { id: true },
            });
            if (talks.length > 0) {
              await prisma.speakerTalk.createMany({
                data: talks.map((t: { id: string }) => ({ speakerId: speaker.id, publicTalkId: t.id })),
                skipDuplicates: true,
              });
            }
          }

          imported++;
          results.push({ line: i + 1, name: `${firstName} ${lastName}` });
        } catch (err) {
          results.push({ line: i + 1, error: err instanceof Error ? err.message : "Unknown error" });
        }
      }

      await audit(actorId, "speaker.import_csv", "", `${imported} speakers imported`);
      return reply.code(201).send({ imported, total: lines.length, results });
    },
  );
}

/** Simple CSV line parser that handles quoted fields */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
