import { z } from 'zod';

export const ErrSchema = z.object({
  success: z.literal(false),
  cause: z.string(),
  code: z.number().int(),
});

export const OkVoidSchema = z.object({
  success: z.literal(true),
});

export const okSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export const resultVoidSchema = z.discriminatedUnion('success', [
  OkVoidSchema,
  ErrSchema,
]);

export const resultVoidSchemaOf = <C extends z.ZodType<string>>(
  causeSchema: C,
) =>
  z.discriminatedUnion('success', [
    OkVoidSchema,
    z.object({
      success: z.literal(false),
      cause: causeSchema,
      code: z.number().int(),
    }),
  ]);

export const resultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.discriminatedUnion('success', [okSchema(dataSchema), ErrSchema]);

export const resultSchemaOf = <
  T extends z.ZodTypeAny,
  C extends z.ZodType<string>,
>(
  dataSchema: T,
  causeSchema: C,
) =>
  z.discriminatedUnion('success', [
    okSchema(dataSchema),
    z.object({
      success: z.literal(false),
      cause: causeSchema,
      code: z.number().int(),
    }),
  ]);

export type Err<TCause extends string = string> = {
  success: false;
  cause: TCause;
  code: number;
};
export type OkVoid = z.infer<typeof OkVoidSchema>;
export type Ok<T> = { success: true; data: T };
export type Result<T, TCause extends string = string> = Ok<T> | Err<TCause>;
export type ResultVoid<TCause extends string = string> = OkVoid | Err<TCause>;
