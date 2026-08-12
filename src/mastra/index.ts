import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { agent } from './agents/agent';
import { classificationAgent } from './agents/classification-agent';
import { componentAgent } from './agents/component-agent';
import { layoutAgent } from './agents/layout-agent';
import { motionAgent } from './agents/motion-agent';
import { visualStyleAgent } from './agents/visual-style-agent';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { webFetchTool } from './tools/web-fetch-tool';
import { extractColorThemeTool } from './tools/extract-color-theme-tool';
import { extractTypographyTool } from './tools/extract-typography-tool';
import { repositoryInspectorTool } from './tools/repository-inspector-tool';
import { frontendAnalysisWorkflow } from './workflows/frontend-analysis-workflow';

export const mastra = new Mastra({
  agents: {
    agent,
    classificationAgent,
    componentAgent,
    layoutAgent,
    motionAgent,
    visualStyleAgent,
  },
  workflows: { frontendAnalysisWorkflow },
  tools: {
    startScheduleTool,
    stopScheduleTool,
    webFetchTool,
    extractColorThemeTool,
    extractTypographyTool,
    repositoryInspectorTool,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
