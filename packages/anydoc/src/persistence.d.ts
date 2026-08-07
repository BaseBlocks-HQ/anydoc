export type PersistencePrimitive = null | boolean | number | string;
export interface EncodedBinary { readonly $anydoc: "binary/base64"; readonly data: string }
export type PersistenceValue = PersistencePrimitive | EncodedBinary | readonly PersistenceValue[] | { readonly [key: string]: PersistenceValue };
export interface PersistenceLimits { readonly maxBytes: number; readonly maxTextBytes: number; readonly maxBinaryBytes: number; readonly maxEntries: number; readonly maxDepth: number }
export interface PersistenceMeasurement { readonly totalBytes: number; readonly textBytes: number; readonly binaryBytes: number; readonly entries: number }
export interface PersistenceCodecOptions extends Partial<PersistenceLimits> { readonly name?: string; readonly code?: "invalid-persistence" | "invalid-source" | "processing-failed" | "sink-failed" }
export declare function encodePersistenceValue(value: unknown, options?: PersistenceCodecOptions): Readonly<{ readonly value: PersistenceValue; readonly measurement: PersistenceMeasurement }>;
export declare function clonePersistenceValue<T extends PersistenceValue>(value: T, options?: PersistenceCodecOptions): T;
export declare function decodePersistenceValue(value: PersistenceValue, options?: PersistenceCodecOptions): unknown;
export declare function measurePersistenceValue(value: unknown, options?: PersistenceCodecOptions): PersistenceMeasurement;
