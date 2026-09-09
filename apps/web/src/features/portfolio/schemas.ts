import { z } from 'zod';

/**
 * Form-shape validation only.
 *
 * "Is this name already taken", "does this building belong to this property" and
 * every other rule that needs the database are answered by the API, whose 409 or
 * 422 is attached to the right field by the form's error handler.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal(''));

/** Money is a string all the way through. Never z.number(). */
const moneySchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount such as 32000 or 32000.00');

const optionalMoneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount such as 32000 or 32000.00')
  .optional()
  .or(z.literal(''));

const optionalIntSchema = (min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine(
      (value) => {
        if (!value) return true;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= min && parsed <= max;
      },
      { message: `Enter a whole number between ${min} and ${max}` },
    );

export const propertyFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  propertyType: z.enum([
    'APARTMENT',
    'RESIDENTIAL',
    'COMMERCIAL',
    'OFFICE',
    'SHOPS',
    'WAREHOUSE',
    'MIXED_USE',
    'OTHER',
  ]),
  addressLine: optionalText(255),
  city: optionalText(100),
  county: optionalText(100),
  country: optionalText(100),
  description: optionalText(2000),
});

export const buildingFormSchema = z.object({
  propertyId: z.string().min(1, 'Choose a property'),
  name: z.string().trim().min(1, 'Enter a name').max(120),
  floors: optionalIntSchema(1, 200),
  description: optionalText(2000),
});

export const unitFormSchema = z.object({
  propertyId: z.string().min(1, 'Choose a property'),
  buildingId: z.string().optional(),
  unitNumber: z.string().trim().min(1, 'Enter a unit number').max(30),
  unitType: z.enum([
    'BEDSITTER',
    'STUDIO',
    'ONE_BEDROOM',
    'TWO_BEDROOM',
    'THREE_BEDROOM',
    'FOUR_BEDROOM',
    'SHOP',
    'OFFICE',
    'WAREHOUSE',
    'OTHER',
  ]),
  monthlyRent: moneySchema,
  securityDeposit: optionalMoneySchema,
  floor: optionalIntSchema(-10, 200),
  bedrooms: optionalIntSchema(0, 50),
  bathrooms: optionalIntSchema(0, 50),
  waterMeterNumber: optionalText(60),
  electricityMeterNumber: optionalText(60),
  description: optionalText(2000),
});

export type PropertyFormValues = z.infer<typeof propertyFormSchema>;
export type BuildingFormValues = z.infer<typeof buildingFormSchema>;
export type UnitFormValues = z.infer<typeof unitFormSchema>;

/**
 * Strips empty strings so the API receives an absent field rather than "".
 * Numeric-looking fields are converted at the boundary; money stays a string.
 */
export function toPayload<T extends Record<string, unknown>>(
  values: T,
  numericFields: (keyof T)[] = [],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue;
    payload[key] = numericFields.includes(key as keyof T) ? Number(value) : value;
  }

  return payload;
}
