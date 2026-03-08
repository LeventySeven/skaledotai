import { z } from 'zod';

const callbackUrlSchema = z
  .string()
  .startsWith("/", "Callback URL must be an internal path.")
  .optional();

export const SignUpSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters long.",
  }),
  email: z.email("Please enter a valid email address."),
  password: z.string().min(8, {
    message: "Password must be at least 8 characters long.",
  }),
  callbackUrl: callbackUrlSchema,
});

export const LoginSchema = z.object({
  email: z.email("Please enter a valid email address."),
  password: z.string().min(1, {
    message: "Please enter your password.",
  }),
  callbackUrl: callbackUrlSchema,
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
