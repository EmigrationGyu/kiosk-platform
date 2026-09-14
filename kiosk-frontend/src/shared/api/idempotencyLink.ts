import { ApolloLink, type Operation } from '@apollo/client';
import { getMainDefinition, Observable } from '@apollo/client/utilities';

const IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key';

type IdempotencyContext = {
  disabled?: boolean;
  key?: string;
  scope?: string;
  registryKey?: string;
};

type OperationContext = {
  headers?: Record<string, string>;
  idempotency?: IdempotencyContext;
};

type InFlightRegistryEntry = {
  key: string;
  refCount: number;
};

const inFlightIdempotencyRegistry = new Map<string, InFlightRegistryEntry>();

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype;
};

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof File !== 'undefined' && value instanceof File) {
    return {
      lastModified: value.lastModified,
      name: value.name,
      size: value.size,
      type: value.type,
    };
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      size: value.size,
      type: value.type,
    };
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizeValue(value[key]);
        return acc;
      }, {});
  }

  return value;
};

const stableSerialize = (value: unknown): string => {
  return JSON.stringify(normalizeValue(value)) ?? 'undefined';
};

const isMutationOperation = (operation: Operation): boolean => {
  const definition = getMainDefinition(operation.query);

  return (
    definition.kind === 'OperationDefinition' &&
    definition.operation === 'mutation'
  );
};

const getOperationContext = (operation: Operation): OperationContext => {
  return operation.getContext() as OperationContext;
};

const getRegistryKey = (operation: Operation, scope?: string): string => {
  return [
    operation.operationName || 'anonymous-mutation',
    stableSerialize(operation.variables),
    scope,
  ]
    .filter(Boolean)
    .join('::');
};

const acquireInFlightKey = (registryKey: string): string => {
  const existing = inFlightIdempotencyRegistry.get(registryKey);

  if (existing) {
    existing.refCount += 1;
    return existing.key;
  }

  const key = crypto.randomUUID();

  inFlightIdempotencyRegistry.set(registryKey, {
    key,
    refCount: 1,
  });

  return key;
};

const releaseInFlightKey = (registryKey?: string): void => {
  if (!registryKey) {
    return;
  }

  const existing = inFlightIdempotencyRegistry.get(registryKey);

  if (!existing) {
    return;
  }

  if (existing.refCount <= 1) {
    inFlightIdempotencyRegistry.delete(registryKey);
    return;
  }

  existing.refCount -= 1;
};

const resolveExplicitKey = (context: OperationContext): string | undefined => {
  return context.idempotency?.key ?? context.headers?.[IDEMPOTENCY_HEADER_NAME];
};

const setIdempotencyContext = (
  operation: Operation,
): { acquiredRegistryKey?: string; key: string } | null => {
  const previousContext = getOperationContext(operation);
  const previousIdempotency = previousContext.idempotency;

  if (previousIdempotency?.disabled) {
    return null;
  }

  const explicitKey = resolveExplicitKey(previousContext);
  const persistedKey = previousIdempotency?.key;
  const existingKey = persistedKey ?? explicitKey;

  if (existingKey) {
    operation.setContext({
      ...previousContext,
      headers: {
        ...previousContext.headers,
        [IDEMPOTENCY_HEADER_NAME]: existingKey,
      },
      idempotency: {
        ...previousIdempotency,
        key: existingKey,
      },
    });

    return { key: existingKey };
  }

  const registryKey = getRegistryKey(operation, previousIdempotency?.scope);
  const key = acquireInFlightKey(registryKey);

  operation.setContext({
    ...previousContext,
    headers: {
      ...previousContext.headers,
      [IDEMPOTENCY_HEADER_NAME]: key,
    },
    idempotency: {
      ...previousIdempotency,
      key,
      registryKey,
    },
  });

  return {
    acquiredRegistryKey: registryKey,
    key,
  };
};

export const idempotencyLink = new ApolloLink((operation, forward) => {
  if (!isMutationOperation(operation)) {
    return forward(operation);
  }

  const resolved = setIdempotencyContext(operation);

  if (!resolved) {
    return forward(operation);
  }

  const acquiredRegistryKey = resolved.acquiredRegistryKey;

  return new Observable((observer) => {
    let released = false;
    const release = () => {
      if (released) {
        return;
      }

      released = true;
      releaseInFlightKey(acquiredRegistryKey);
    };

    const subscription = forward(operation).subscribe({
      complete: () => {
        release();
        observer.complete();
      },
      error: (error) => {
        release();
        observer.error(error);
      },
      next: (value) => {
        observer.next(value);
      },
    });

    return () => {
      release();
      subscription.unsubscribe();
    };
  });
});
