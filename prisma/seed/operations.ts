import type { MaintenanceStatus, PrismaClient } from '@pm/database';

/**
 * Maintenance requests and staff assignments for development and the
 * end-to-end suite.
 *
 * The spread is deliberate: jobs at every stage of the workflow, a couple of
 * urgent ones still open, and a completed one with a real cost — so the board
 * has something to show other than a single column.
 *
 * No documents are seeded. A document row without its stored bytes would be a
 * broken download that looks like working data, and writing fixture files into
 * the storage volume from a seed is worse — so the documents screen starts
 * genuinely empty and says so.
 */

interface JobTemplate {
  title: string;
  description: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: MaintenanceStatus;
  daysAgo: number;
  estimatedCost?: string;
  actualCost?: string;
}

const JOBS: JobTemplate[] = [
  {
    title: 'Kitchen tap will not close',
    description: 'Dripping constantly since Tuesday; the washer looks worn.',
    priority: 'MEDIUM',
    status: 'PENDING',
    daysAgo: 2,
    estimatedCost: '3500.00',
  },
  {
    title: 'No water on the third floor',
    description: 'Pressure dropped overnight. Tank may be empty or the pump has failed.',
    priority: 'URGENT',
    status: 'PENDING',
    daysAgo: 4,
    estimatedCost: '18000.00',
  },
  {
    title: 'Gate motor sticking',
    description: 'The automatic gate stops halfway and has to be pushed.',
    priority: 'HIGH',
    status: 'ASSIGNED',
    daysAgo: 6,
    estimatedCost: '12000.00',
  },
  {
    title: 'Corridor lights out, Block B',
    description: 'Three fittings on the second floor are dead.',
    priority: 'MEDIUM',
    status: 'IN_PROGRESS',
    daysAgo: 9,
    estimatedCost: '4500.00',
  },
  {
    title: 'Blocked drain behind the bins',
    description: 'Standing water and a smell after the last rain.',
    priority: 'HIGH',
    status: 'COMPLETED',
    daysAgo: 21,
    estimatedCost: '8000.00',
    actualCost: '9500.00',
  },
  {
    title: 'Repaint the stairwell',
    description: 'Cosmetic; scuffed along the handrail.',
    priority: 'LOW',
    status: 'CANCELLED',
    daysAgo: 30,
  },
];

/** The timeline a job of this status would really have accumulated. */
function timelineFor(status: MaintenanceStatus): { note: string; to: MaintenanceStatus }[] {
  const raised = [{ note: 'Request raised.', to: 'PENDING' as MaintenanceStatus }];
  switch (status) {
    case 'PENDING':
      return raised;
    case 'ASSIGNED':
      return [...raised, { note: 'Assigned to the caretaker.', to: 'ASSIGNED' }];
    case 'IN_PROGRESS':
      return [
        ...raised,
        { note: 'Assigned to the caretaker.', to: 'ASSIGNED' },
        { note: 'Electrician on site.', to: 'IN_PROGRESS' },
      ];
    case 'COMPLETED':
      return [
        ...raised,
        { note: 'Assigned to the caretaker.', to: 'ASSIGNED' },
        { note: 'Plumber booked.', to: 'IN_PROGRESS' },
        { note: 'Drain cleared and tested.', to: 'COMPLETED' },
      ];
    case 'CANCELLED':
      return [...raised, { note: 'Deferred to the next budget year.', to: 'CANCELLED' }];
    default:
      return raised;
  }
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export async function seedOperations(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed operations demo data in production.');
  }

  const abc = await prisma.organization.findUnique({ where: { code: 'ABC' } });
  if (!abc) return;

  const properties = await prisma.property.findMany({
    where: { organizationId: abc.id },
    select: { id: true },
    orderBy: { name: 'asc' },
  });
  if (properties.length === 0) return;

  const units = await prisma.unit.findMany({
    where: { organizationId: abc.id },
    select: { id: true, propertyId: true, buildingId: true },
    orderBy: { unitNumber: 'asc' },
    take: 20,
  });

  const owner = await prisma.user.findFirst({
    where: { organizationId: abc.id, roles: { some: { role: { name: 'PROPERTY_OWNER' } } } },
    select: { id: true },
  });
  const caretaker = await prisma.user.findFirst({
    where: { organizationId: abc.id, roles: { some: { role: { name: 'CARETAKER' } } } },
    select: { id: true },
  });

  let created = 0;

  for (const [index, job] of JOBS.entries()) {
    const property = properties[index % properties.length]!;
    // Half the jobs are on a specific unit, half on the property itself —
    // a generator service belongs to the building, not to a tenant.
    const unit = index % 2 === 0 ? units.find((u) => u.propertyId === property.id) : undefined;

    const existing = await prisma.maintenanceRequest.findFirst({
      where: { organizationId: abc.id, title: job.title },
      select: { id: true },
    });
    if (existing) continue;

    const createdAt = daysAgo(job.daysAgo);
    const isAssigned = job.status !== 'PENDING' && job.status !== 'CANCELLED';

    const request = await prisma.maintenanceRequest.create({
      data: {
        organizationId: abc.id,
        propertyId: property.id,
        buildingId: unit?.buildingId ?? null,
        unitId: unit?.id ?? null,
        title: job.title,
        description: job.description,
        priority: job.priority,
        status: job.status,
        assignedToId: isAssigned ? (caretaker?.id ?? owner?.id ?? null) : null,
        estimatedCost: job.estimatedCost ?? null,
        actualCost: job.actualCost ?? null,
        reportedById: owner?.id ?? null,
        // The CHECK constraint requires these two to agree.
        completedAt: job.status === 'COMPLETED' ? daysAgo(job.daysAgo - 3) : null,
        createdAt,
      },
      select: { id: true },
    });

    const entries = timelineFor(job.status);
    for (const [step, entry] of entries.entries()) {
      await prisma.maintenanceUpdate.create({
        data: {
          organizationId: abc.id,
          maintenanceRequestId: request.id,
          authorId: owner?.id ?? null,
          note: entry.note,
          fromStatus: step === 0 ? null : entries[step - 1]!.to,
          toStatus: entry.to,
          createdAt: new Date(createdAt.getTime() + step * 3_600_000),
        },
      });
    }
    created++;
  }

  console.log(`  ${created} maintenance request(s) with timelines`);
}
