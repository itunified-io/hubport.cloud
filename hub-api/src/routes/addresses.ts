/**
 * Address routes — CRUD for territory addresses with visit logging.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const TerritoryIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type TerritoryIdParamsType = Static<typeof TerritoryIdParams>;

const AddressIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
  addrId: Type.String({ format: "uuid" }),
});
type AddressIdParamsType = Static<typeof AddressIdParams>;

const AddressBody = Type.Object({
  lat: Type.Number({ minimum: -90, maximum: 90 }),
  lng: Type.Number({ minimum: -180, maximum: 180 }),
  street: Type.Optional(Type.String()),
  houseNumber: Type.Optional(Type.String()),
  city: Type.Optional(Type.String()),
  postcode: Type.Optional(Type.String()),
  buildingType: Type.Optional(Type.String()),
  units: Type.Optional(Type.Integer({ minimum: 1 })),
  bellCount: Type.Optional(Type.Integer({ minimum: 1 })),
  floor: Type.Optional(Type.String()),
  type: Type.Optional(
    Type.Union([
      Type.Literal("residential"),
      Type.Literal("business"),
      Type.Literal("apartment_building"),
      Type.Literal("rural"),
    ]),
  ),
  languages: Type.Optional(Type.Array(Type.String())),
  doNotCallReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  doNotVisitUntil: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sortOrder: Type.Optional(Type.Integer()),
});
type AddressBodyType = Static<typeof AddressBody>;

const AddressUpdateBody = Type.Object({
  lat: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
  lng: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
  street: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  houseNumber: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  city: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  postcode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  buildingType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  units: Type.Optional(Type.Integer({ minimum: 1 })),
  bellCount: Type.Optional(Type.Integer({ minimum: 1 })),
  floor: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  type: Type.Optional(
    Type.Union([
      Type.Literal("residential"),
      Type.Literal("business"),
      Type.Literal("apartment_building"),
      Type.Literal("rural"),
    ]),
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal("active"),
      Type.Literal("do_not_call"),
      Type.Literal("not_at_home"),
      Type.Literal("moved"),
      Type.Literal("deceased"),
      Type.Literal("foreign_language"),
      Type.Literal("archived"),
    ]),
  ),
  languages: Type.Optional(Type.Array(Type.String())),
  doNotCallReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  doNotVisitUntil: Type.Optional(Type.Union([Type.String({ format: "date-time" }), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sortOrder: Type.Optional(Type.Integer()),
  // Frontend compat aliases
  languageSpoken: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
type AddressUpdateBodyType = Static<typeof AddressUpdateBody>;

const BulkAddressBody = Type.Object({
  addresses: Type.Array(AddressBody, { maxItems: 500 }),
});
type BulkAddressBodyType = Static<typeof BulkAddressBody>;

const VisitBody = Type.Object({
  outcome: Type.Union([
    Type.Literal("contacted"),
    Type.Literal("not_at_home"),
    Type.Literal("do_not_call"),
    Type.Literal("moved"),
    Type.Literal("letter_sent"),
    Type.Literal("phone_attempted"),
  ]),
  notes: Type.Optional(Type.String()),
});
type VisitBodyType = Static<typeof VisitBody>;

// ─── Response mapper ───────────────────────────────────────────
// Maps Prisma Address fields to the names the frontend expects.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toApiAddress(addr: any) {
  const { id, lat, lng, street, houseNumber, postcode, osmId, lastVisitAt, languages, ...rest } = addr;
  return {
    ...rest,
    addressId: id,
    streetAddress: [street, houseNumber].filter(Boolean).join(" ") || null,
    apartment: rest.floor ?? null,
    postalCode: postcode ?? null,
    latitude: lat,
    longitude: lng,
    osmNodeId: osmId ?? null,
    lastVisitDate: lastVisitAt?.toISOString?.() ?? lastVisitAt ?? null,
    languageSpoken: Array.isArray(languages) && languages.length > 0 ? languages[0] : null,
  };
}

export async function addressRoutes(app: FastifyInstance): Promise<void> {
  // ─── List addresses for a territory ──────────────────────────────
  app.get<{ Params: TerritoryIdParamsType }>(
    "/territories/:id/addresses",
    {
      preHandler: requirePermission(PERMISSIONS.ADDRESSES_VIEW),
      schema: { params: TerritoryIdParams },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      const now = new Date();

      // Fetch addresses with auto-revert of expired DNC
      const addresses = await prisma.address.findMany({
        where: { territoryId: request.params.id },
        orderBy: [{ sortOrder: "asc" }, { street: "asc" }, { houseNumber: "asc" }],
        include: {
          visits: {
            orderBy: { visitedAt: "desc" },
            take: 5,
            include: { publisher: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
      });

      // Auto-revert expired DNC addresses back to active
      const expiredDnc = addresses.filter(
        (a) =>
          a.status === "do_not_call" &&
          a.doNotVisitUntil &&
          new Date(a.doNotVisitUntil) <= now,
      );

      if (expiredDnc.length > 0) {
        await prisma.address.updateMany({
          where: {
            id: { in: expiredDnc.map((a) => a.id) },
          },
          data: {
            status: "active",
            doNotCallReason: null,
            doNotVisitUntil: null,
          },
        });

        // Update in-memory for response
        for (const addr of addresses) {
          if (expiredDnc.some((e) => e.id === addr.id)) {
            addr.status = "active";
            addr.doNotCallReason = null;
            addr.doNotVisitUntil = null;
          }
        }
      }

      return addresses.map(toApiAddress);
    },
  );

  // ─── Create address ──────────────────────────────────────────────
  app.post<{ Params: TerritoryIdParamsType; Body: AddressBodyType }>(
    "/territories/:id/addresses",
    {
      preHandler: requirePermission(PERMISSIONS.ADDRESSES_EDIT),
      schema: { params: TerritoryIdParams, body: AddressBody },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      const { doNotVisitUntil, ...rest } = request.body;
      const address = await prisma.address.create({
        data: {
          ...rest,
          territoryId: request.params.id,
          doNotVisitUntil: doNotVisitUntil ? new Date(doNotVisitUntil) : undefined,
        },
      });

      // Set PostGIS point via raw SQL
      await prisma.$executeRaw`
        UPDATE "Address"
        SET "updatedAt" = now()
        WHERE id = ${address.id}::uuid
      `;

      return reply.code(201).send(toApiAddress(address));
    },
  );

  // ─── Update address ──────────────────────────────────────────────
  app.put<{ Params: AddressIdParamsType; Body: AddressUpdateBodyType }>(
    "/territories/:id/addresses/:addrId",
    {
      preHandler: requirePermission(PERMISSIONS.ADDRESSES_EDIT),
      schema: { params: AddressIdParams, body: AddressUpdateBody },
    },
    async (request, reply) => {
      const address = await prisma.address.findFirst({
        where: {
          id: request.params.addrId,
          territoryId: request.params.id,
        },
      });
      if (!address) {
        return reply.code(404).send({ error: "Address not found" });
      }

      const { doNotVisitUntil, languageSpoken, ...rest } = request.body;
      const updated = await prisma.address.update({
        where: { id: request.params.addrId },
        data: {
          ...rest,
          // Map frontend languageSpoken → backend languages array
          ...(languageSpoken !== undefined
            ? { languages: languageSpoken ? [languageSpoken] : [] }
            : {}),
          doNotVisitUntil: doNotVisitUntil === null ? null : doNotVisitUntil ? new Date(doNotVisitUntil) : undefined,
        },
      });

      return toApiAddress(updated);
    },
  );

  // ─── Delete address (cascades visits) ────────────────────────────
  app.delete<{ Params: AddressIdParamsType }>(
    "/territories/:id/addresses/:addrId",
    {
      preHandler: requirePermission(PERMISSIONS.ADDRESSES_EDIT),
      schema: { params: AddressIdParams },
    },
    async (request, reply) => {
      const address = await prisma.address.findFirst({
        where: {
          id: request.params.addrId,
          territoryId: request.params.id,
        },
      });
      if (!address) {
        return reply.code(404).send({ error: "Address not found" });
      }

      await prisma.address.delete({
        where: { id: request.params.addrId },
      });

      return reply.code(204).send();
    },
  );

  // ─── Bulk create addresses (max 500) ─────────────────────────────
  app.post<{ Params: TerritoryIdParamsType; Body: BulkAddressBodyType }>(
    "/territories/:id/addresses/bulk",
    {
      preHandler: requirePermission(PERMISSIONS.ADDRESSES_EDIT),
      schema: { params: TerritoryIdParams, body: BulkAddressBody },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      if (request.body.addresses.length > 500) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Maximum 500 addresses per bulk request",
        });
      }

      const created = await prisma.address.createMany({
        data: request.body.addresses.map((addr) => ({
          ...addr,
          territoryId: request.params.id,
          doNotVisitUntil: addr.doNotVisitUntil ? new Date(addr.doNotVisitUntil) : undefined,
        })),
      });

      return reply.code(201).send({ created: created.count });
    },
  );

  // ─── Log visit (immutable) ───────────────────────────────────────
  app.post<{ Params: AddressIdParamsType; Body: VisitBodyType }>(
    "/territories/:id/addresses/:addrId/visits",
    {
      preHandler: requirePermission(PERMISSIONS.ADDRESSES_VISIT),
      schema: { params: AddressIdParams, body: VisitBody },
    },
    async (request, reply) => {
      const address = await prisma.address.findFirst({
        where: {
          id: request.params.addrId,
          territoryId: request.params.id,
        },
      });
      if (!address) {
        return reply.code(404).send({ error: "Address not found" });
      }

      const publisherId = request.user?.sub;
      if (!publisherId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      // Find publisher by keycloakSub
      const publisher = await prisma.publisher.findFirst({
        where: { keycloakSub: publisherId },
      });
      if (!publisher) {
        return reply.code(404).send({ error: "Publisher not found" });
      }

      const now = new Date();

      // Create immutable visit record + denormalize lastVisitAt
      const [visit] = await prisma.$transaction([
        prisma.addressVisit.create({
          data: {
            addressId: request.params.addrId,
            publisherId: publisher.id,
            outcome: request.body.outcome,
            notes: request.body.notes,
            visitedAt: now,
          },
          include: {
            publisher: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        prisma.address.update({
          where: { id: request.params.addrId },
          data: { lastVisitAt: now },
        }),
      ]);

      // If outcome is do_not_call, also update address status
      if (request.body.outcome === "do_not_call") {
        await prisma.address.update({
          where: { id: request.params.addrId },
          data: { status: "do_not_call" },
        });
      }

      return reply.code(201).send(visit);
    },
  );
}
