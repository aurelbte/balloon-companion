type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Clones the plain-data domain graph without relying on browser APIs.
 */
export function cloneDomainValue<T>(value: T): T {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneDomainValue(item)) as T;
  }
  const clone: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneDomainValue(
      (value as Record<PropertyKey, unknown>)[key],
    );
  }
  return clone as T;
}

export type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : { readonly [Key in keyof T]: DeepReadonly<T[Key]> };

/**
 * Freezes every nested object and array and returns the same reference.
 */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value === null || typeof value !== "object") {
    return value as DeepReadonly<T>;
  }
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}
