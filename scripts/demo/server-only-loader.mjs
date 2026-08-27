export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      shortCircuit: true,
      url: new URL("../../src/test/server-only-stub.ts", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
