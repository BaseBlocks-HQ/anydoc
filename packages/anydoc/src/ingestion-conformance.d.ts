import type { IngestionJobStore } from "./ingestion.js";

export interface IngestionJobStoreConformanceTest {
  readonly name: string;
  run(createStore: () => IngestionJobStore | Promise<IngestionJobStore>): Promise<void>;
}

export declare const ingestionJobStoreConformanceTests: readonly IngestionJobStoreConformanceTest[];
export declare function runIngestionJobStoreConformance(createStore: () => IngestionJobStore | Promise<IngestionJobStore>): Promise<Readonly<{ readonly passed: readonly string[]; readonly total: number }>>;
