import { z } from "https://esm.sh/zod";


export const ParsedCompanyDataSchema = z.object({
  name: z.string(),
  industry: z.array(z.string()).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  website: z.string().optional(),
});

export type ParsedCompanyData = z.infer<typeof ParsedCompanyDataSchema>;
