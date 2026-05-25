let importCounter = 0;

export async function importFresh(moduleUrl) {
  const url = new URL(moduleUrl);
  url.searchParams.set("testImport", String(++importCounter));
  return import(url.href);
}

export async function flushMicrotasks(iterations = 6) {
  for (let index = 0; index < iterations; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export async function waitFor(predicate, options = {}) {
  const { attempts = 40, iterationsPerAttempt = 2 } = options;

  for (let index = 0; index < attempts; index += 1) {
    const result = await predicate();
    if (result) {
      return result;
    }

    await flushMicrotasks(iterationsPerAttempt);
  }

  throw new Error("Timed out waiting for test condition");
}

export function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}
