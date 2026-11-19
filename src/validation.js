import { z } from 'zod';

const trimmed = (max) => z.string().trim().max(max);
const optionalInt = (min, max) => z.number().int().min(min).max(max).nullable().optional();

export const emailSchema = z.string().trim().toLowerCase().email().max(190);
export const passwordSchema = z.string().min(12, 'Password must be at least 12 characters.').max(128);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const productSchema = z.object({
  code: z.number().int().min(1).max(999999).optional(),
  name: trimmed(120).min(1, 'Name is required.'),
  nameAr: trimmed(120).default(''),
  nameEn: trimmed(120).default(''),
  description: trimmed(1000).default(''),
  descriptionAr: trimmed(1000).default(''),
  descriptionEn: trimmed(1000).default(''),
  categoryId: z.number().int().positive().nullable().optional(),
  widthCm: optionalInt(1, 500),
  heightCm: optionalInt(1, 500),
  price: optionalInt(0, 1_000_000_000),
  stock: optionalInt(0, 1_000_000),
  visible: z.boolean().default(true),
  featured: z.boolean().default(false),
  sort: z.number().int().min(-100000).max(100000).optional(),
});

// Defaults would turn missing fields into '' on update, so the patch schema is built without them.
export const productPatchSchema = productSchema
  .extend({
    nameAr: trimmed(120).optional(),
    nameEn: trimmed(120).optional(),
    description: trimmed(1000).optional(),
    descriptionAr: trimmed(1000).optional(),
    descriptionEn: trimmed(1000).optional(),
    visible: z.boolean().optional(),
    featured: z.boolean().optional(),
  })
  .partial();

export const categorySchema = z.object({
  name: trimmed(60).min(1, 'Name is required.'),
  nameAr: trimmed(60).default(''),
  nameEn: trimmed(60).default(''),
  sort: z.number().int().min(-1000).max(1000).default(0),
});

export const categoryPatchSchema = z
  .object({ name: trimmed(60).min(1, 'Name is required.'), nameAr: trimmed(60), nameEn: trimmed(60), sort: z.number().int().min(-1000).max(1000) })
  .partial();

export const galleryPatchSchema = z
  .object({ caption: trimmed(200), captionAr: trimmed(200), captionEn: trimmed(200), featured: z.boolean() })
  .partial();

export const orderItemSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  productName: trimmed(120).min(1),
  qty: z.number().int().min(1).max(10000),
  unitPrice: z.number().int().min(0).max(1_000_000_000),
});

export const orderSchema = z.object({
  customerName: trimmed(120).min(1, 'Customer name is required.'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number.'),
  address: trimmed(300).default(''),
  note: trimmed(500).default(''),
  items: z.array(orderItemSchema).min(1, 'Add at least one item.').max(100),
});

export const orderStatusSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'delivered', 'cancelled']),
});

// Links must be https so a typo or a pasted script can never become a clickable javascript: link.
const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === '' || /^https:\/\/[^\s<>"']+$/.test(v), 'Links must start with https://');
const coordinate = (limit) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^-?\d{1,3}(\.\d{1,8})?$/.test(v) && Math.abs(Number(v)) <= limit), 'Enter a number such as 36.9123 (leave empty if unknown).');

export const settingsSchema = z
  .object({
    shop_name: trimmed(80).min(1),
    shop_name_ar: trimmed(80),
    shop_name_en: trimmed(80),
    phone_primary: trimmed(30),
    phone_secondary: trimmed(30),
    whatsapp_number: z.string().trim().regex(/^[0-9]{8,15}$/, 'Use digits only, with country code, e.g. 9647504251661.'),
    tiktok_handle: z.string().trim().max(60).regex(/^@?[A-Za-z0-9._]*$/, 'TikTok handle: letters, numbers, dots and underscores only.'),
    facebook_url: httpsUrl,
    instagram_url: httpsUrl,
    address: trimmed(200),
    address_ar: trimmed(200),
    address_en: trimmed(200),
    map_url: httpsUrl,
    map_lat: coordinate(90),
    map_lng: coordinate(180),
    founded_year: z.string().trim().regex(/^[0-9]{4}$/, 'Use a four-digit year.'),
    currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, e.g. IQD.'),
    default_language: z.enum(['ku', 'ar', 'en']),
    seo_title_ku: trimmed(90),
    seo_title_ar: trimmed(90),
    seo_title_en: trimmed(90),
    seo_description_ku: trimmed(300),
    seo_description_ar: trimmed(300),
    seo_description_en: trimmed(300),
  })
  .partial()
  .refine((s) => (s.map_lat === undefined && s.map_lng === undefined) || (s.map_lat === '') === (s.map_lng === ''), {
    message: 'Enter both latitude and longitude, or leave both empty.',
  });

export const newUserSchema = z.object({
  email: emailSchema,
  displayName: trimmed(80).min(1),
  role: z.enum(['owner', 'staff']).default('staff'),
  password: passwordSchema,
});

export const userPatchSchema = z.object({
  role: z.enum(['owner', 'staff']).optional(),
  active: z.boolean().optional(),
  displayName: trimmed(80).min(1).optional(),
});

export const passwordResetSchema = z.object({ password: passwordSchema });

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const idParam = z.coerce.number().int().positive();

/** Parses req.body with a zod schema and returns { data } or { error }. */
export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return { data: result.data };
  const issue = result.error.issues[0];
  return { error: issue?.message || 'Invalid input.' };
}
