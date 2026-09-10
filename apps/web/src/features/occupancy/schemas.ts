import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, 'Enter a valid phone number');

const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount such as 32000 or 32000.00');

const optionalMoneySchema = moneySchema.optional().or(z.literal(''));

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');

export const tenantFormSchema = z.object({
  fullName: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  phone: phoneSchema,
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  idType: z.enum(['NATIONAL_ID', 'PASSPORT', 'ALIEN_ID', 'MILITARY_ID', 'OTHER']).optional(),
  nationalId: optionalText(50),
  occupation: optionalText(120),
  address: optionalText(255),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: phoneSchema.optional().or(z.literal('')),
  notes: optionalText(2000),
});

export const leaseFormSchema = z
  .object({
    tenantId: z.string().min(1, 'Choose a tenant'),
    unitId: z.string().min(1, 'Choose a vacant unit'),
    startDate: dateSchema,
    endDate: dateSchema.optional().or(z.literal('')),
    monthlyRent: optionalMoneySchema,
    securityDeposit: optionalMoneySchema,
    depositPaid: optionalMoneySchema,
    dueDay: z
      .string()
      .trim()
      .refine(
        (value) => {
          const parsed = Number(value);
          return Number.isInteger(parsed) && parsed >= 1 && parsed <= 28;
        },
        // 1-28 rather than 1-31: rent must fall due on a day every month has,
        // or February silently skips a billing cycle.
        { message: 'Choose a day between 1 and 28' },
      ),
    notes: optionalText(2000),
  })
  .refine((data) => !data.endDate || data.endDate > data.startDate, {
    path: ['endDate'],
    message: 'The end date must be after the start date',
  })
  .refine(
    (data) =>
      !data.depositPaid ||
      !data.securityDeposit ||
      Number(data.depositPaid) <= Number(data.securityDeposit),
    {
      path: ['depositPaid'],
      // Only a shape check for instant feedback — the API's Decimal comparison
      // is the one that decides.
      message: 'Cannot be more than the security deposit',
    },
  );

export const renewLeaseSchema = z.object({
  endDate: dateSchema,
  monthlyRent: optionalMoneySchema,
  notes: optionalText(500),
});

export const terminateLeaseSchema = z.object({
  reason: optionalText(500),
  unitStatus: z.enum(['VACANT', 'MAINTENANCE']),
});

export type TenantFormValues = z.infer<typeof tenantFormSchema>;
export type LeaseFormValues = z.infer<typeof leaseFormSchema>;
export type RenewLeaseValues = z.infer<typeof renewLeaseSchema>;
export type TerminateLeaseValues = z.infer<typeof terminateLeaseSchema>;
