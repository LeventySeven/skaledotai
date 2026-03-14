import type { XDataProvider } from "@/lib/x";
import type {
  ProjectRunOperationType,
  ProjectRunTrace,
  ProjectRunTraceMetric,
  ProjectRunTraceStatus,
  ProjectRunTraceStep,
} from "@/lib/validations/project-runs";

type TraceStepInput = Omit<ProjectRunTraceStep, "id" | "tools" | "bullets" | "metrics"> & {
  id?: string;
  tools?: string[];
  bullets?: string[];
  metrics?: ProjectRunTraceMetric[];
};

export function createProjectRunTraceBuilder(input: {
  title: string;
  operationType: ProjectRunOperationType;
  requestedProvider: XDataProvider;
}) {
  const startedAt = Date.now();
  const steps: ProjectRunTraceStep[] = [];
  let index = 0;

  return {
    addStep(step: TraceStepInput): void {
      index += 1;
      steps.push({
        ...step,
        id: step.id ?? `step-${index}`,
        tools: step.tools ?? [],
        bullets: step.bullets ?? [],
        metrics: step.metrics ?? [],
      });
    },

    build(summary: string, status: ProjectRunTraceStatus = "success"): ProjectRunTrace {
      const completedAt = Date.now();

      return {
        title: input.title,
        summary,
        status,
        operationType: input.operationType,
        requestedProvider: input.requestedProvider,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - startedAt,
        steps,
      };
    },
  };
}
