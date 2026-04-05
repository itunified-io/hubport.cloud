import prisma from "./prisma.js";

/**
 * Migrates cleaning permission data to facilities namespace.
 * Idempotent — safe to run multiple times.
 */
export async function migrateFacilitiesPermissions(): Promise<void> {
  // 1. Rename "Cleaning Responsible" role to "Cleaning Coordinator"
  await prisma.appRole.updateMany({
    where: { name: "Cleaning Responsible" },
    data: { name: "Cleaning Coordinator" },
  });

  // 2. Migrate permission strings in all AppRole.permissions JSON arrays
  const roles = await prisma.appRole.findMany();
  for (const role of roles) {
    const perms = role.permissions as string[];
    let changed = false;
    const updated = perms.map((p) => {
      if (p === "app:cleaning.view") { changed = true; return "app:facilities.view"; }
      if (p === "manage:cleaning") { changed = true; return "manage:facilities.cleaning"; }
      return p;
    });
    // "manage:cleaning" also grants grounds access
    if (perms.includes("manage:cleaning") && !updated.includes("manage:facilities.grounds")) {
      updated.push("manage:facilities.grounds");
      changed = true;
    }
    if (changed) {
      await prisma.appRole.update({
        where: { id: role.id },
        data: { permissions: updated },
      });
    }
  }

  console.log("[migration] Facilities permissions migrated");
}
