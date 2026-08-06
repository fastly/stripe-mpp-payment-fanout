export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  return deepEqual(a, b, new WeakMap<object, WeakSet<object>>());
}

function deepEqual(a: unknown, b: unknown, seen: WeakMap<object, WeakSet<object>>): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (typeof a !== typeof b) {
    return false;
  }

  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  const aObject = a as object;
  const bObject = b as object;
  const seenForA = seen.get(aObject);
  if (seenForA?.has(bObject)) {
    return true;
  }
  if (seenForA) {
    seenForA.add(bObject);
  } else {
    seen.set(aObject, new WeakSet([bObject]));
  }

  const aProto = Object.getPrototypeOf(aObject);
  const bProto = Object.getPrototypeOf(bObject);
  if (aProto !== bProto) {
    return false;
  }

  if (aObject instanceof Date && bObject instanceof Date) {
    return Object.is(aObject.getTime(), bObject.getTime());
  }

  if (aObject instanceof RegExp && bObject instanceof RegExp) {
    return aObject.source === bObject.source && aObject.flags === bObject.flags;
  }

  if (ArrayBuffer.isView(aObject) && ArrayBuffer.isView(bObject)) {
    return typedArrayEqual(aObject, bObject);
  }

  if (aObject instanceof ArrayBuffer && bObject instanceof ArrayBuffer) {
    return bytesEqual(new Uint8Array(aObject), new Uint8Array(bObject));
  }

  if (aObject instanceof Map && bObject instanceof Map) {
    return mapEqual(aObject, bObject, seen);
  }

  if (aObject instanceof Set && bObject instanceof Set) {
    return setEqual(aObject, bObject, seen);
  }

  const aKeys = Reflect.ownKeys(aObject);
  const bKeys = Reflect.ownKeys(bObject);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if (!Object.prototype.propertyIsEnumerable.call(aObject, key)) {
      continue;
    }
    if (!Object.prototype.propertyIsEnumerable.call(bObject, key)) {
      return false;
    }
    if (!deepEqual((aObject as Record<PropertyKey, unknown>)[key], (bObject as Record<PropertyKey, unknown>)[key], seen)) {
      return false;
    }
  }

  return true;
}

function typedArrayEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) {
    return false;
  }
  return bytesEqual(
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength),
    new Uint8Array(b.buffer, b.byteOffset, b.byteLength),
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function mapEqual(a: Map<unknown, unknown>, b: Map<unknown, unknown>, seen: WeakMap<object, WeakSet<object>>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [aKey, aValue] of a) {
    let matched = false;
    for (const [bKey, bValue] of b) {
      if (deepEqual(aKey, bKey, seen) && deepEqual(aValue, bValue, seen)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

function setEqual(a: Set<unknown>, b: Set<unknown>, seen: WeakMap<object, WeakSet<object>>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const aValue of a) {
    let matched = false;
    for (const bValue of b) {
      if (deepEqual(aValue, bValue, seen)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}

export default {
  isDeepStrictEqual,
};
