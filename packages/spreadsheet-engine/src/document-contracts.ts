export type DocumentDiagnostic = Readonly<{
  code: string;
  location?: unknown;
  message: string;
  severity: "info" | "warning" | "error";
}>;

export type DocumentCommandSchema = Readonly<{
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  mutates: boolean;
  name: string;
  outputSchema: Readonly<Record<string, unknown>>;
}>;

export type DocumentFeatureSupport = Readonly<{
  inspect: boolean;
  mutate: boolean;
  render: "native" | "placeholder" | "unsupported";
  roundTrip: "preserve" | "lossy" | "unsupported";
}>;

export type DocumentEngineDescriptor = Readonly<{
  commands: readonly DocumentCommandSchema[];
  engineVersion: string;
  features: Readonly<Record<string, DocumentFeatureSupport>>;
  format: string;
  mediaTypes: readonly string[];
}>;

export type DocumentEngineVerification = Readonly<{
  checks: Readonly<Record<string, "passed" | "failed" | "not-applicable">>;
  diagnostics: readonly DocumentDiagnostic[];
  renderArtifacts: readonly Readonly<{
    bytes: Uint8Array;
    region: string;
    surfaceId: string;
  }>[];
}>;

export interface DocumentFormatEngine<State = unknown> {
  readonly descriptor: DocumentEngineDescriptor;
  close(state: State): Promise<void>;
  execute(input: {
    arguments: unknown;
    command: string;
    state: State;
  }): Promise<Readonly<{
    changed: boolean;
    diagnostics?: readonly DocumentDiagnostic[];
    result: unknown;
    state: State;
  }>>;
  export(state: State): Promise<Uint8Array>;
  open(input: { bytes: Uint8Array; fileName?: string; mediaType?: string }): Promise<State>;
  verify(input: { bytes: Uint8Array; state: State }): Promise<DocumentEngineVerification>;
}
