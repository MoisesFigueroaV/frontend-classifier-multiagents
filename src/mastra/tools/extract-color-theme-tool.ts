import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const sourceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const colorOccurrenceSchema = z.object({
  value: z.string(),
  count: z.number().int().positive(),
  sources: z.array(z.string()),
});

const colorThemeResultSchema = z.object({
  colors: z.array(colorOccurrenceSchema),

  cssVariables: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      source: z.string(),
    }),
  ),

  gradients: z.array(
    z.object({
      value: z.string(),
      source: z.string(),
    }),
  ),

  evidence: z.array(
    z.object({
      value: z.string(),
      property: z.string(),
      source: z.string(),
    }),
  ),
});

function normalizeHex(value: string) {
  return value.toLowerCase();
}

export const extractColorThemeTool = createTool({
  id: 'extract-color-theme',

  description:
    'Extracts colors, CSS variables and gradients from frontend styles and theme files.',

  inputSchema: z.object({
    files: z.array(sourceFileSchema),
  }),

  outputSchema: colorThemeResultSchema,

  execute: async ({ files }) => {
    const colorMap = new Map<
      string,
      {
        count: number;
        sources: Set<string>;
      }
    >();

    const cssVariables: Array<{
      name: string;
      value: string;
      source: string;
    }> = [];

    const gradients: Array<{
      value: string;
      source: string;
    }> = [];

    const evidence: Array<{
      value: string;
      property: string;
      source: string;
    }> = [];

    for (const file of files) {
      const content = file.content;

      // HEX colors
      const hexRegex =
        /#[0-9a-fA-F]{3,4}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{8}\b/g;

      for (const match of content.matchAll(hexRegex)) {
        const color = normalizeHex(match[0]);

        const existing = colorMap.get(color) ?? {
          count: 0,
          sources: new Set<string>(),
        };

        existing.count += 1;
        existing.sources.add(file.path);

        colorMap.set(color, existing);

        evidence.push({
          value: color,
          property: 'color',
          source: file.path,
        });
      }

      // rgb(), rgba(), hsl(), hsla()
      const functionalColorRegex =
        /\b(?:rgb|rgba|hsl|hsla)\([^)]+\)/gi;

      for (const match of content.matchAll(functionalColorRegex)) {
        const color = match[0]
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

        const existing = colorMap.get(color) ?? {
          count: 0,
          sources: new Set<string>(),
        };

        existing.count += 1;
        existing.sources.add(file.path);

        colorMap.set(color, existing);
      }

      // CSS variables
      // --primary: #7c3aed;
      const variableRegex =
        /(--[\w-]+)\s*:\s*([^;}\n]+)\s*;/g;

      for (const match of content.matchAll(variableRegex)) {
        cssVariables.push({
          name: match[1],
          value: match[2].trim(),
          source: file.path,
        });
      }

      // gradients
      const gradientRegex =
        /(?:linear|radial|conic)-gradient\([^;]+\)/gi;

      for (const match of content.matchAll(gradientRegex)) {
        gradients.push({
          value: match[0].trim(),
          source: file.path,
        });

        evidence.push({
          value: match[0].trim(),
          property: 'gradient',
          source: file.path,
        });
      }
    }

    const colors = [...colorMap.entries()]
      .map(([value, data]) => ({
        value,
        count: data.count,
        sources: [...data.sources],
      }))
      .sort((a, b) => b.count - a.count);

    return {
      colors,
      cssVariables,
      gradients,
      evidence,
    };
  },
});
