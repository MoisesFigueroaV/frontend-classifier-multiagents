// src/mastra/schemas/project-context.ts

import { z } from 'zod';

export const projectContextSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    isFrontend: z.boolean(),
    framework: z.string().min(1),
    language: z.string().min(1),
  }),

  libraries: z.object({
    ui: z.array(z.string()),
    styling: z.array(z.string()),
    motion: z.array(z.string()),
  }),

  structure: z.object({
    componentDirectories: z.array(z.string()),
    pageDirectories: z.array(z.string()),
    styleDirectories: z.array(z.string()),
    themeFiles: z.array(z.string()),
  }),

  relevantFiles: z.object({
    components: z.array(z.string()),
    pages: z.array(z.string()),
    styles: z.array(z.string()),
    themes: z.array(z.string()),
  }),
});

export type ProjectContext = z.infer<
  typeof projectContextSchema
>;
