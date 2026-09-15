import { z } from "zod";

import { attributionSchema } from "@/lib/payments/attribution";

export const storefrontItemsSchema = z
  .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
  .min(1)
  .max(30);

export const storefrontQuoteSchema = z.object({
  items: storefrontItemsSchema,
  postalCode: z.string().trim().min(3).max(16).optional(),
});

export const storefrontCheckoutSchema = z.object({
  items: storefrontItemsSchema,
  customer: z.object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(160),
    phone: z.string().trim().min(5).max(32),
  }),
  address: z.object({
    postalCode: z.string().trim().min(3).max(16),
    street: z.string().trim().min(1).max(160),
    number: z.string().trim().min(1).max(20).optional(),
    complement: z.string().trim().max(120).optional(),
    district: z.string().trim().max(80).optional(),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().max(40).optional(),
  }),
  shippingOptionId: z.string().trim().min(1).max(40),
  attribution: attributionSchema,
});

export const storefrontTokenSchema = z.object({
  publicToken: z.string().trim().min(10).max(120),
});
