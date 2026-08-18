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

function fontFamilyFromPackage(value: string) {
  return value
    .replace(/^@fontsource(?:-variable)?\//, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.toLowerCase() === 'jetbrains'
      ? 'JetBrains'
      : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
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

      // CSS font tokens, e.g. --font-sans: "Geist", ui-sans-serif.
      // They are deterministic declarations, unlike a bare var(--font-sans)
      // reference which does not reveal the actual family.
      for (const match of content.matchAll(/--font-[\w-]+\s*:\s*([^;}\n]+)/gi)) {
        for (const family of cleanFontFamily(match[1] ?? '')) {
          if (/^(?:var\(|ui-|system-ui|sans-serif|serif|monospace)/i.test(family)) continue;
          fontFamilies.add(family);
          evidence.push({
            value: family,
            property: 'font-token',
            source: file.path,
          });
        }
      }

      // next/font/google imports make the font choice explicit in source.
      for (const match of content.matchAll(/import\s*{([^}]+)}\s*from\s*["']next\/font\/google["']/g)) {
        for (const imported of (match[1] ?? '').split(',')) {
          const family = imported.trim().split(/\s+as\s+/i)[0]?.replace(/_/g, ' ').trim();
          if (!family) continue;
          fontFamilies.add(family);
          declaredFonts.push({ family, source: file.path });
          evidence.push({ value: family, property: 'next/font/google import', source: file.path });
        }
      }

      // @fontsource packages are explicit package/import declarations.
      for (const match of content.matchAll(/(?:@import\s*|from\s*)["'](@fontsource(?:-variable)?\/[^"']+)["']/g)) {
        const family = fontFamilyFromPackage(match[1] ?? '');
        if (!family) continue;
        fontFamilies.add(family);
        declaredFonts.push({ family, source: file.path });
        evidence.push({ value: family, property: 'fontsource import', source: file.path });
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
