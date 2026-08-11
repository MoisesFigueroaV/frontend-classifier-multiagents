import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const sourceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const typographyResultSchema = z.object({
  fontFamilies: z.array(z.string()),

  fontWeights: z.array(z.number()),

  fontSizes: z.array(z.string()),

  declaredFonts: z.array(
    z.object({
      family: z.string(),
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

function cleanFontFamily(value: string) {
  return value
    .replace(/["']/g, '')
    .split(',')
    .map((font) => font.trim())
    .filter(Boolean);
}

export const extractTypographyTool = createTool({
  id: 'extract-typography',

  description:
    'Extracts typography information such as font families, weights and sizes from frontend source files.',

  inputSchema: z.object({
    files: z.array(sourceFileSchema),
  }),

  outputSchema: typographyResultSchema,

  execute: async ({ files }) => {
    const fontFamilies = new Set<string>();
    const fontWeights = new Set<number>();
    const fontSizes = new Set<string>();

    const declaredFonts: Array<{
      family: string;
      source: string;
    }> = [];

    const evidence: Array<{
      value: string;
      property: string;
      source: string;
    }> = [];

    for (const file of files) {
      const content = file.content;

      // font-family: Inter, sans-serif;
      const familyRegex = /font-family\s*:\s*([^;}\n]+)/gi;

      for (const match of content.matchAll(familyRegex)) {
        const families = cleanFontFamily(match[1]);

        for (const family of families) {
          fontFamilies.add(family);

          evidence.push({
            value: family,
            property: 'font-family',
            source: file.path,
          });
        }
      }

      // font-weight: 400;
      const weightRegex = /font-weight\s*:\s*(\d{3})/gi;

      for (const match of content.matchAll(weightRegex)) {
        const weight = Number(match[1]);

        fontWeights.add(weight);

        evidence.push({
          value: String(weight),
          property: 'font-weight',
          source: file.path,
        });
      }

      // font-size: 16px / 1rem / etc.
      const sizeRegex =
        /font-size\s*:\s*([0-9.]+(?:px|rem|em|clamp\([^;]+\)))/gi;

      for (const match of content.matchAll(sizeRegex)) {
        const size = match[1].trim();

        fontSizes.add(size);

        evidence.push({
          value: size,
          property: 'font-size',
          source: file.path,
        });
      }

      // @font-face { font-family: "..."; }
      const fontFaceRegex =
        /@font-face\s*{[\s\S]*?font-family\s*:\s*["']?([^;"'}]+)["']?[\s\S]*?}/gi;

      for (const match of content.matchAll(fontFaceRegex)) {
        const family = match[1].trim();

        declaredFonts.push({
          family,
          source: file.path,
        });

        fontFamilies.add(family);
      }
    }

    return {
      fontFamilies: [...fontFamilies],
      fontWeights: [...fontWeights].sort((a, b) => a - b),
      fontSizes: [...fontSizes],
      declaredFonts,
      evidence,
    };
  },
});
